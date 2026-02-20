// E:\Hyak-Tracker\background.js
import { createHyakApi } from "./src/api/hyakanime/index.js";
import { createLogger } from "./src/core/logger.js";

const logger = createLogger({
  scope: "background",
});

let cachedToken = null;

const hyakApi = createHyakApi({
  getToken: async () => {
    if (cachedToken) return cachedToken;
    const s = await chrome.storage.local.get(["hyakanimeToken"]);
    cachedToken = s.hyakanimeToken || null;
    return cachedToken;
  },
});

self.hyakApi = hyakApi;

// ---- STREAM CONTEXT CACHE (RAM only, scoped per tab) ----
const streamSessions = new Map(); // tabId -> { ctx, ts }

// ---- GLOBAL LOG STORE (RAM only, scoped per tab; session = TOP host only) ----
// Objectif:
// - stocker TOUS les logs (même debug OFF)
// - merger streaming + player (iframes) dans la même session de l'onglet
// - purge UNIQUEMENT quand le TOP hostname change (navigation onglet)
// - purge au démarrage / install / fermeture onglet
//
// logsByTab : tabId -> { topHost: string, logs: LogEntry[] }
const logsByTab = new Map();
const topHostByTab = new Map(); // tabId -> hostname (TOP frame)
const topUrlByTab = new Map(); // tabId -> url (TOP frame, sans hash)

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function purgeAllLogs() {
  logger.info("Purge globale des logs (startup/install)");
  logsByTab.clear();
  topHostByTab.clear();
  topUrlByTab.clear();
}

function purgeTabLogs(tabId) {
  logger.debug("Purge logs onglet", { tabId });
  logsByTab.delete(tabId);
  topHostByTab.delete(tabId);
  topUrlByTab.delete(tabId);
}

function ensureTabBucket(tabId) {
  const topHost = topHostByTab.get(tabId) || "";
  const cur = logsByTab.get(tabId);

  if (!cur) {
    const bucket = { topHost, logs: [] };
    logsByTab.set(tabId, bucket);
    return bucket;
  }

  // Si topHost a été initialisé après, on sync
  if (!cur.topHost && topHost) cur.topHost = topHost;

  // IMPORTANT: on ne purge pas sur LOG_PUSH (iframes).
  // La purge se fait uniquement sur tabs.onUpdated (TOP nav).
  return cur;
}

function normalizeTopUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function pushLog(tabId, entry) {
  const bucket = ensureTabBucket(tabId);
  bucket.logs.push(entry);
}

async function cleanupAnimeLinkMap() {
  const { animeLinkMap = {} } = await chrome.storage.local.get("animeLinkMap");

  const now = Date.now();
  const TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours

  let changed = false;

  for (const [k, v] of Object.entries(animeLinkMap)) {
    if (!v?.ts || now - v.ts > TTL) {
      delete animeLinkMap[k];
      changed = true;
    }
  }

  // cap à 200 entrées
  const entries = Object.entries(animeLinkMap).sort(
    (a, b) => (b[1]?.ts ?? 0) - (a[1]?.ts ?? 0),
  );

  if (entries.length > 200) {
    for (const [k] of entries.slice(200)) {
      delete animeLinkMap[k];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ animeLinkMap });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  streamSessions.delete(tabId);
  purgeTabLogs(tabId);
});

// TOP navigation: purge si le hostname de l'onglet change.
// (Les logs des iframes ne doivent jamais déclencher de purge.)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo?.url) return;

  const nextTopUrl = normalizeTopUrl(changeInfo.url);
  if (!nextTopUrl) return;

  const nextTopHost = getHostFromUrl(nextTopUrl);
  if (!nextTopHost) return;

  const prevTopUrl = topUrlByTab.get(tabId) || "";
  const prevTopHost = topHostByTab.get(tabId) || "";

  topUrlByTab.set(tabId, nextTopUrl);
  topHostByTab.set(tabId, nextTopHost);

  logger.debug("Navigation détectée", {
    tabId,
    nextTopHost,
    prevTopHost,
    nextTopUrl,
    prevTopUrl,
  });

  // ✅ Nouvelle règle: purge dès que l'URL TOP change (même host identique)
  if (prevTopUrl && prevTopUrl !== nextTopUrl) {
    logsByTab.set(tabId, { topHost: nextTopHost, logs: [] });
    logger.info("Changement topUrl → purge session logs", {
      tabId,
      from: prevTopUrl,
      to: nextTopUrl,
    });
    return;
  }

  // fallback cohérence bucket
  const bucket = logsByTab.get(tabId);
  if (bucket && !bucket.topHost) bucket.topHost = nextTopHost;
  if (bucket && bucket.topHost !== nextTopHost) {
    logsByTab.set(tabId, { topHost: nextTopHost, logs: [] });
  }
});

function base64UrlToBase64(s) {
  return String(s)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(s).length / 4) * 4, "=");
}

function safeDecodeJwtPayload(token) {
  try {
    const t = String(token || "").trim();
    const raw = t.startsWith("Bearer ") ? t.slice(7) : t;

    const part = raw.split(".")[1];
    if (!part) return null;

    const json = atob(base64UrlToBase64(part));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * ✅ Init-only: si uid absent et token présent, tente de dériver uid depuis token (JWT).
 * - ne suppose pas que c'est toujours un JWT: si ça échoue -> no-op.
 */
async function ensureUidFromStoredToken() {
  const s = await chrome.storage.local.get(["hyakanimeUid", "hyakanimeToken"]);

  if (s.hyakanimeUid) return;

  const token = s.hyakanimeToken || null;
  if (!token) return;

  const payload = safeDecodeJwtPayload(token);
  const uid = payload?.uid || payload?._id || payload?.sub || null;

  if (!uid) return;

  await chrome.storage.local.set({ hyakanimeUid: uid });
  logger.info("UID Hyakanime initialisé depuis token (startup/install)", {
    uid,
  });
}

async function writeProgressionCore({ uid, animeId, episode }) {
  if (!uid) return { ok: false, error: "NO_UID" };
  if (!Number.isFinite(animeId) || !Number.isFinite(episode) || episode <= 0) {
    return { ok: false, error: "BAD_ARGS" };
  }

  // 1) Etat actuel normalisé
  const current = await hyakApi.progression.detail({ uid, animeId });
  if (!current.ok) return current;

  const detail = current.data;

  // ✅ épisode AVANT write (source de vérité pour l'historique)
  const oldEpisode = detail?.progress?.currentEpisode ?? null;

  const totalEpisodes = detail?.media?.totalEpisodes ?? null;

  const existingStatus = detail?.progress?.status ?? null; // 1..6
  const existingStart = detail?.progress?.startDate ?? null;
  const existingEnd = detail?.progress?.endDate ?? null;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // 2) Status commun
  let status = existingStatus ?? 1;
  const canDecideFinish = Number.isFinite(totalEpisodes) && totalEpisodes > 0;
  const willFinish = canDecideFinish && episode >= totalEpisodes;

  if (willFinish) {
    status = 3;
  } else {
    if (episode >= 1 && (status === 2 || status === 4 || status === 5)) {
      status = 1;
    }
  }

  // 3) Extra commun
  const extra = { lastChange: nowMs };

  if (!existingStart && episode >= 1) {
    extra.startDate = nowIso;
  }

  if (status === 3 && !existingEnd) {
    extra.endDate = nowIso;
  }

  // 4) writeSafe
  const r = await hyakApi.progression.writeSafe({
    uid,
    animeId,
    episode,
    status,
    extra,
  });

  if (!r.ok) {
    return {
      ok: false,
      status: r.error?.status ?? 0,
      error: r.error,
    };
  }

  return {
    ok: true,
    data: r.data,
    meta: {
      oldEpisode, // ✅ utilisé pour l'historique
    },
  };
}

chrome.runtime.onStartup.addListener(() => {
  purgeAllLogs();
  cleanupAnimeLinkMap().catch(() => {});
  ensureUidFromStoredToken().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  purgeAllLogs();
  cleanupAnimeLinkMap().catch(() => {});
  ensureUidFromStoredToken().catch(() => {});
});

// ---- AUTOMARK HISTORY (persistent, circular max 10) ----

const HISTORY_KEY = "autoMarkHistory";
const HISTORY_LIMIT = 10;

async function getHistory() {
  const s = await chrome.storage.local.get([HISTORY_KEY]);
  return Array.isArray(s[HISTORY_KEY]) ? s[HISTORY_KEY] : [];
}

async function pushHistory(entry) {
  const history = await getHistory();

  const head = history[0] || null;

  // déduplication simple
  if (
    head &&
    head.animeId === entry.animeId &&
    head.newEpisode === entry.newEpisode
  ) {
    return;
  }

  history.unshift({
    date: entry.date,
    animeId: entry.animeId,
    oldEpisode: entry.oldEpisode ?? null,
    newEpisode: entry.newEpisode,
  });

  if (history.length > HISTORY_LIMIT) {
    history.length = HISTORY_LIMIT;
  }

  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

async function writeProgressionDowngrade({ uid, animeId, episode }) {
  if (!uid) return { ok: false, error: "NO_UID" };
  if (!Number.isFinite(animeId)) return { ok: false, error: "BAD_ARGS" };
  if (!Number.isFinite(episode) || episode <= 0) {
    return { ok: false, error: "BAD_EPISODE" };
  }

  // 1) Lire l’état actuel pour récupérer status/dates
  const current = await hyakApi.progression.detail({ uid, animeId });
  if (!current.ok) return current;

  const detail = current.data;

  const totalEpisodes = detail?.media?.totalEpisodes ?? null;

  const existingStatus = detail?.progress?.status ?? 1;
  const existingStart = detail?.progress?.startDate ?? null;
  const existingEnd = detail?.progress?.endDate ?? null;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // 2) Recalculer un status cohérent avec l’épisode visé
  let status = existingStatus;

  const canDecideFinish = Number.isFinite(totalEpisodes) && totalEpisodes > 0;
  const willFinish = canDecideFinish && episode >= totalEpisodes;

  if (willFinish) {
    status = 3; // terminé
  } else {
    // si on “dé-finish” un animé
    if (status === 3) status = 1;

    // si status était "à voir / pause / abandonné", revenir "en cours" dès qu’on a une progression
    if (episode >= 1 && (status === 2 || status === 4 || status === 5)) {
      status = 1;
    }
  }

  // 3) Extra: lastChange obligatoire + dates cohérentes
  const extra = { lastChange: nowMs };

  // startDate: garder l’existant si présent, sinon en poser un
  if (existingStart) {
    extra.startDate = existingStart;
  } else if (episode >= 1) {
    extra.startDate = nowIso;
  }

  // endDate: uniquement si status=3, sinon ne PAS l’envoyer (évite incohérences)
  if (status === 3) {
    extra.endDate = existingEnd || nowIso;
  }

  // 4) Écriture unsafe (downgrade autorisé)
  return hyakApi.progression.writeUnsafe({
    uid,
    animeId,
    episode,
    status,
    extra,
  });
}

// -------------------- RESOLVE_ANIME (source de vérité popup + automark) --------------------

function normTitle(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\[\(].*?[\]\)]/g, " ")
    .replace(/(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSearchQueries(title, seasonHint) {
  const q = String(title || "").trim();
  const n = parseInt(seasonHint, 10);

  if (!Number.isFinite(n) || n <= 1) return [q];
  return [`${q} saison ${n}`, `${q} season ${n}`, `${q} s${n}`, q];
}

function getAllTitles(anime) {
  const arr = [];

  if (anime?.displayTitle) arr.push(anime.displayTitle);

  const t = anime?.titles;
  if (t?.fr) arr.push(t.fr);
  if (t?.en) arr.push(t.en);
  if (t?.jp) arr.push(t.jp);
  if (t?.romaji) arr.push(t.romaji);

  if (anime?.title) arr.push(anime.title);
  if (anime?.titleEN) arr.push(anime.titleEN);
  if (anime?.titleJP) arr.push(anime.titleJP);
  if (anime?.romanji) arr.push(anime.romanji);
  if (Array.isArray(anime?.alt)) arr.push(...anime.alt);

  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  const jacc = union ? inter / union : 0;

  let i = 0;
  for (; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) break;
  const prefix = i / Math.max(a.length, b.length);

  return Math.max(jacc, prefix * 0.85);
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function editSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen ? 1 - d / maxLen : 0;
}

function rankItems(items, query) {
  const q = normTitle(query);

  const ranked = items.map((it) => {
    const titles = getAllTitles(it)
      .map((raw) => ({ raw, n: normTitle(raw) }))
      .filter((x) => x.n);

    for (const t of titles) {
      if (t.n === q) {
        return { it, score: 1.0, matchedOn: t.raw, perfect: true };
      }
    }

    let best = 0;
    let matchedOn = null;

    for (const t of titles) {
      if (t.n.includes(q) || q.includes(t.n)) {
        if (0.95 > best) {
          best = 0.95;
          matchedOn = t.raw;
        }
        continue;
      }

      const s1 = similarity(q, t.n);
      const s2 = editSimilarity(q, t.n);
      const s = Math.max(s1, s2);

      if (s > best) {
        best = s;
        matchedOn = t.raw;
      }
    }

    const quasiPerfect = best >= 0.92;
    return { it, score: best, matchedOn, perfect: quasiPerfect };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

async function resolveAnimeCore({ title, seasonHint, limit = 6 }) {
  const queries = buildSearchQueries(title, seasonHint);

  let allItems = [];
  const seen = new Set();
  const tried = [];

  for (const q of queries) {
    const r = await hyakApi.search.anime(q);

    const items = Array.isArray(r.data)
      ? r.data
      : Array.isArray(r.data?.data)
        ? r.data.data
        : Array.isArray(r.data?.results)
          ? r.data.results
          : [];

    tried.push({ q, ok: !!r.ok, count: items.length });

    if (!r.ok) continue;

    for (const it of items) {
      const id = it?.id;
      if (id == null) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      allItems.push(it);
    }
  }

  if (!allItems.length) {
    return { ok: true, found: false, tried, ranked: [], best: null };
  }

  let ranked = rankItems(allItems, title).slice(0, Math.max(1, limit));

  // Bonus saison (copié popup)
  const n = parseInt(seasonHint, 10);
  if (Number.isFinite(n) && n > 1) {
    const sTok = String(n);

    ranked.sort((a, b) => {
      const aHas =
        normTitle(a.matchedOn || "").includes(`saison ${sTok}`) ||
        normTitle(a.matchedOn || "").includes(`season ${sTok}`) ||
        normTitle(a.matchedOn || "").includes(`s${sTok}`);
      const bHas =
        normTitle(b.matchedOn || "").includes(`saison ${sTok}`) ||
        normTitle(b.matchedOn || "").includes(`season ${sTok}`) ||
        normTitle(b.matchedOn || "").includes(`s${sTok}`);

      if (aHas !== bHas) return aHas ? -1 : 1;
      return b.score - a.score;
    });

    const rootNorm = normTitle(title);
    const filtered = ranked.filter(
      (r) => normTitle(r.matchedOn || "") !== rootNorm,
    );
    if (filtered.length) ranked = filtered;
  }

  const best = ranked[0] || null;

  return {
    ok: true,
    found: true,
    tried,
    ranked,
    best,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // 🔎 Log léger (pas de spam): uniquement pour messages non-triviaux
      // (Tu peux commenter si tu veux 0 bruit)
      // logger.debug("onMessage", { type: msg?.type, from: sender?.url });

      // ----- LOGS (global, RAM only) -----
      if (msg?.type === "LOG_PUSH") {
        const tabId = sender?.tab?.id ?? msg?.tabId;
        if (!tabId) {
          sendResponse({ ok: false, error: "NO_TAB" });
          return;
        }

        const originHost =
          String(
            msg?.originHost ??
              msg?.siteKey ??
              msg?.hostname ??
              getHostFromUrl(msg?.url || "") ??
              "",
          ) || "";

        const originUrl = String(msg?.originUrl ?? msg?.url ?? "") || "";
        const level = String(msg?.level || "info");

        let kind = String(msg?.kind || "log");
        if (kind !== "log" && kind !== "step") kind = "log";

        const scope = String(msg?.scope || "app");
        const message = String(msg?.message || "");
        const data = msg?.data ?? undefined;

        const topHost =
          getHostFromUrl(sender?.tab?.url || "") ||
          topHostByTab.get(tabId) ||
          "";

        if (topHost && topHostByTab.get(tabId) !== topHost) {
          topHostByTab.set(tabId, topHost);
          const bucket = logsByTab.get(tabId);
          if (bucket && bucket.topHost && bucket.topHost !== topHost) {
            bucket.topHost = topHost;
          }
        }

        const topUrl = normalizeTopUrl(sender?.tab?.url || "");
        if (topUrl && topUrlByTab.get(tabId) !== topUrl) {
          topUrlByTab.set(tabId, topUrl);
        }

        pushLog(tabId, {
          ts: Date.now(),
          level,
          kind,
          scope,
          message,
          data,
          originHost,
          originUrl,
        });

        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "LOG_GET_CURRENT") {
        const tabId = sender?.tab?.id ?? msg?.tabId;
        if (!tabId) {
          sendResponse({ ok: false, error: "NO_TAB" });
          return;
        }

        const bucket = logsByTab.get(tabId) || null;
        sendResponse({
          ok: true,
          siteKey: bucket?.topHost || topHostByTab.get(tabId) || "",
          logs: bucket?.logs || [],
        });
        return;
      }

      if (msg?.type === "LOG_CLEAR_CURRENT") {
        const tabId = sender?.tab?.id ?? msg?.tabId;
        if (!tabId) {
          sendResponse({ ok: false, error: "NO_TAB" });
          return;
        }

        const topHost = topHostByTab.get(tabId) || "";
        logsByTab.set(tabId, { topHost, logs: [] });
        sendResponse({ ok: true });
        return;
      }

      // ----- STREAM CONTEXT -----
      if (msg?.type === "STREAM_UPDATE") {
        const tabId = sender?.tab?.id;
        logger.debug("STREAM_UPDATE reçu", {
          tabId,
          title: msg.payload?.title,
          episode: msg.payload?.episode,
        });
        if (!tabId) {
          sendResponse({ ok: false, error: "NO_TAB" });
          return;
        }

        streamSessions.set(tabId, { ctx: msg.payload, ts: Date.now() });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "GET_STREAM_CONTEXT") {
        const tabId = sender?.tab?.id ?? msg?.tabId;
        logger.debug("GET_STREAM_CONTEXT", { tabId });
        if (!tabId) {
          sendResponse({ ok: false, error: "NO_TAB" });
          return;
        }

        const session = streamSessions.get(tabId) || null;
        sendResponse({ ok: true, ctx: session?.ctx || null });
        return;
      }

      // ----- TOKEN -----
      if (msg?.type === "HYAKANIME_TOKEN") {
        cachedToken = msg.token;
        await chrome.storage.local.set({ hyakanimeToken: cachedToken });
        logger.info("Token Hyakanime mis à jour");

        // ✅ IMPORTANT: dériver l'UID immédiatement (automark n'attend pas l'ouverture du popup)
        try {
          const payload = safeDecodeJwtPayload(cachedToken);
          const uid = payload?.uid || payload?._id || payload?.sub || null;

          if (uid) {
            const s = await chrome.storage.local.get(["hyakanimeUid"]);
            if (s.hyakanimeUid !== uid) {
              await chrome.storage.local.set({ hyakanimeUid: uid });
              logger.info("UID Hyakanime mis à jour depuis token", { uid });
            }
          }
        } catch (e) {
          logger.warn("Impossible de dériver UID depuis token", {
            message: e?.message,
          });
        }

        sendResponse({ ok: true });
        return;
      }

      // ----- SESSION HYAKANIME -----
      if (msg?.type === "GET_SESSION") {
        // 1) charger token depuis cache/storage
        if (!cachedToken) {
          const s = await chrome.storage.local.get(["hyakanimeToken"]);
          cachedToken = s.hyakanimeToken || null;
        }

        // 2) pas de token => pas de session
        if (!cachedToken) {
          sendResponse({
            ok: true,
            authenticated: false,
            uid: null,
          });
          return;
        }

        // 3) token présent => decode JWT côté background
        const payload = safeDecodeJwtPayload(cachedToken);
        const uid = payload?.uid || payload?._id || payload?.sub || null;

        // 4) si uid trouvé => on le persiste (utile pour d'autres flows)
        if (uid) {
          await chrome.storage.local.set({ hyakanimeUid: uid });
        }

        sendResponse({
          ok: true,
          authenticated: !!uid,
          uid: uid || null,
        });
        return;
      }

      // ----- SEARCH -----
      if (msg?.type === "SEARCH_ANIME") {
        const q = msg.query || "";
        logger.debug("SEARCH_ANIME", { query: q });
        const r = await hyakApi.search.anime(q);
        sendResponse(r);
        logger.info("SEARCH_ANIME résultat", {
          ok: r.ok,
          count: Array.isArray(r.data) ? r.data.length : 0,
        });
        return;
      }

      // ----- WRITE PROGRESSION -----
      if (msg?.type === "WRITE_PROGRESSION") {
        const wanted = Number.parseInt(msg.progression, 10);
        const animeId = Number.parseInt(msg.animeID ?? msg.id, 10);

        let uid = msg.uid;
        if (!uid) {
          const s = await chrome.storage.local.get(["hyakanimeUid"]);
          uid = s.hyakanimeUid || null;
        }

        logger.info("WRITE_PROGRESSION demandé", { animeId, wanted });

        const result = await writeProgressionCore({
          uid,
          animeId,
          episode: wanted,
        });

        if (!result.ok) {
          logger.error("WRITE_PROGRESSION échec", result.error);
          sendResponse(result);
          return;
        }

        logger.info("WRITE_PROGRESSION succès", {
          animeId,
          progression: wanted,
        });

        sendResponse({ ok: true, status: 200, data: result.data });
        return;
      }

      // ----- GET PROGRESSION -----
      if (msg?.type === "GET_PROGRESSION_ANIME") {
        const uid = msg.uid;
        const animeId = Number.parseInt(msg.animeId, 10);

        if (!uid || !Number.isFinite(animeId)) {
          sendResponse({ ok: false, error: "BAD_ARGS" });
          return;
        }

        logger.debug("GET_PROGRESSION_ANIME", { animeId });
        const r = await hyakApi.progression.detail({ uid, animeId });

        if (!r.ok) {
          sendResponse({
            ok: false,
            status: r.error?.status ?? 0,
            data: null,
            error: r.error,
          });
          logger.error("GET_PROGRESSION_ANIME échec", r.error);
          return;
        }

        sendResponse({ ok: true, status: 200, data: r.data });
        return;
      }

      // ----- GLOBAL AUTOMARK COMMIT -----
      if (msg?.type === "AUTOMARK_COMMIT") {
        const tabId = sender?.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: "NO_TAB" });
          return;
        }

        // ✅ FIX: ctx doit exister AVANT d'être loggué
        const ctx = msg.ctx || streamSessions.get(tabId)?.ctx || null;

        logger.info("AUTOMARK_COMMIT reçu", {
          tabId,
          hasCtx: !!ctx,
          title: ctx?.title ?? null,
          season: ctx?.season ?? null,
          episode: msg?.episode ?? null,
          senderUrl: sender?.url ?? null,
        });

        if (!ctx?.title || !msg.episode) {
          sendResponse({ ok: false, error: "NO_CTX" });
          logger.warn("AUTOMARK_COMMIT NO_CTX", { tabId, ctx });
          return;
        }

        const ep = Number.parseInt(msg.episode, 10);
        if (!Number.isFinite(ep) || ep <= 0) {
          sendResponse({ ok: false, error: "BAD_EPISODE" });
          logger.warn("AUTOMARK_COMMIT BAD_EPISODE", {
            tabId,
            episode: msg.episode,
          });
          return;
        }

        pushLog(tabId, {
          ts: Date.now(),
          level: "info",
          kind: "step",
          scope: "automark/bg",
          message: `📩 Automark commit reçu (E${ep})`,
        });

        const { hyakanimeUid, animeLinkMap = {} } =
          await chrome.storage.local.get(["hyakanimeUid", "animeLinkMap"]);

        if (!hyakanimeUid) {
          sendResponse({ ok: false, error: "NO_UID" });
          logger.warn("AUTOMARK_COMMIT NO_UID", { tabId });
          return;
        }

        function norm(s) {
          return (s || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .replace(/[\[\(].*?[\]\)]/g, " ")
            .replace(
              /(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g,
              " ",
            )
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        }

        const season = ctx.season ?? 1;
        const mapKey = `${norm(ctx.title)}|s${season}`;

        let animeId = animeLinkMap?.[mapKey]?.animeId ?? null;
        animeId = Number.parseInt(animeId, 10);

        if (!Number.isFinite(animeId)) {
          logger.info("AUTOMARK mapping manquant → RESOLVE_ANIME", {
            tabId,
            title: ctx.title,
            season,
            mapKey,
          });

          const rr = await resolveAnimeCore({
            title: ctx.title,
            seasonHint: season,
            limit: 6,
          });

          const pickedId = Number.parseInt(rr?.best?.it?.id, 10);

          if (rr?.found && Number.isFinite(pickedId)) {
            animeId = pickedId;

            animeLinkMap[mapKey] = {
              animeId,
              season,
              titleRaw: ctx.title,
              ts: Date.now(),
              auto: true,
              // trace utile pour debug
              resolvedOn: rr?.best?.matchedOn ?? null,
              score: rr?.best?.score ?? null,
              tried: rr?.tried ?? [],
            };

            await chrome.storage.local.set({ animeLinkMap });

            logger.info("AUTOMARK mapping créé via RESOLVE_ANIME", {
              tabId,
              mapKey,
              animeId,
              resolvedOn: rr?.best?.matchedOn ?? null,
              score: rr?.best?.score ?? null,
            });
          } else {
            logger.warn("AUTOMARK RESOLVE_ANIME vide", {
              tabId,
              title: ctx.title,
              season,
              tried: rr?.tried ?? [],
            });
          }
        }

        if (!Number.isFinite(animeId)) {
          sendResponse({ ok: false, error: "ANIME_NOT_FOUND" });
          logger.warn("AUTOMARK anime introuvable", {
            tabId,
            title: ctx.title,
            season,
          });
          return;
        }

        logger.info("AUTOMARK write via core", {
          tabId,
          uid: hyakanimeUid,
          animeId,
          ep,
        });

        const result = await writeProgressionCore({
          uid: hyakanimeUid,
          animeId,
          episode: ep,
        });

        if (!result.ok) {
          pushLog(tabId, {
            ts: Date.now(),
            level: "error",
            kind: "step",
            scope: "automark/bg",
            message: "❌ Automark: write failed",
            data: result.error,
          });

          sendResponse({
            ok: false,
            error: "WRITE_FAILED",
            details: result.error,
          });
          return;
        }

        const wrData = result.data;

        if (wrData?.skipped) {
          pushLog(tabId, {
            ts: Date.now(),
            level: "info",
            kind: "step",
            scope: "automark/bg",
            message: `⏭️ Automark ignoré (déjà à jour) → ${wrData?.known ?? "?"}`,
            data: { known: wrData?.known, wanted: wrData?.wanted },
          });
        } else {
          await pushHistory({
            date: Date.now(),
            animeId,
            oldEpisode: result?.meta?.oldEpisode ?? null,
            newEpisode: ep,
          });

          pushLog(tabId, {
            ts: Date.now(),
            level: "info",
            kind: "step",
            scope: "automark/bg",
            message: `✅ Automark progression écrite → ${ep}`,
          });
        }

        await cleanupAnimeLinkMap();

        sendResponse({
          ok: true,
          animeId,
          progression: ep,
          skipped: wrData?.skipped ?? undefined,
          known: wrData?.known ?? undefined,
          wanted: wrData?.wanted ?? undefined,
        });
        logger.info("AUTOMARK_COMMIT réponse envoyée", {
          tabId,
          ok: true,
          animeId,
          ep,
        });
        return;
      }

      // ----- LIST USER PROGRESSION (for calendrier) -----
      if (msg?.type === "GET_USER_PROGRESSION_LIST") {
        const s = await chrome.storage.local.get(["hyakanimeUid"]);
        const uid = s.hyakanimeUid || null;

        if (!uid) {
          sendResponse({ ok: false, error: "NO_UID" });
          return;
        }

        logger.debug("GET_USER_PROGRESSION_LIST", { uid });

        const r = await hyakApi.progression.listByUid(uid);

        if (!r.ok) {
          logger.error("GET_USER_PROGRESSION_LIST échec", r.error);
          sendResponse({
            ok: false,
            status: r.error?.status ?? 0,
            error: r.error,
          });
          return;
        }

        logger.info("GET_USER_PROGRESSION_LIST succès", {
          count: Array.isArray(r.data) ? r.data.length : 0,
        });

        sendResponse({ ok: true, uid, data: r.data });
        return;
      }

      // ----- HISTORY GET -----
      if (msg?.type === "HISTORY_GET") {
        const history = await getHistory();
        sendResponse({ ok: true, history });
        return;
      }

      // ----- HISTORY UNDO BY INDEX -----
      if (msg?.type === "HISTORY_UNDO_INDEX") {
        const index = Number(msg?.index);

        const history = await getHistory();
        if (!history.length) {
          sendResponse({ ok: false, error: "EMPTY_HISTORY" });
          return;
        }

        if (!Number.isFinite(index) || index < 0 || index >= history.length) {
          sendResponse({ ok: false, error: "BAD_INDEX" });
          return;
        }

        const entry = history[index];
        const animeId = Number.parseInt(entry?.animeId, 10);

        if (!Number.isFinite(animeId)) {
          sendResponse({ ok: false, error: "BAD_ANIME_ID" });
          return;
        }

        // 🔒 sécurité: on n'autorise l'undo que sur la première occurrence (la + récente) de cet animeId
        const newestIndexForAnime = history.findIndex(
          (x) => Number.parseInt(x?.animeId, 10) === animeId,
        );

        if (newestIndexForAnime !== index) {
          sendResponse({ ok: false, error: "NOT_NEWEST_FOR_ANIME" });
          return;
        }

        const { hyakanimeUid } = await chrome.storage.local.get([
          "hyakanimeUid",
        ]);
        if (!hyakanimeUid) {
          sendResponse({ ok: false, error: "NO_UID" });
          return;
        }

        // 🔒 garde cohérence : la progression actuelle de CET animé doit matcher newEpisode
        const current = await hyakApi.progression.detail({
          uid: hyakanimeUid,
          animeId,
        });

        if (!current.ok) {
          sendResponse(current);
          return;
        }

        const currentEp = current.data?.progress?.currentEpisode ?? null;
        if (currentEp !== entry.newEpisode) {
          sendResponse({ ok: false, error: "STATE_MISMATCH" });
          return;
        }

        // ✅ appliquer undo
        const oldEp = entry.oldEpisode;

        let actionResult;
        if (oldEp == null) {
          actionResult = await hyakApi.progression.delete({ animeId });
        } else {
          actionResult = await writeProgressionDowngrade({
            uid: hyakanimeUid,
            animeId,
            episode: Number(oldEp),
          });
        }

        if (!actionResult?.ok) {
          sendResponse(actionResult);
          return;
        }

        // ✅ retirer uniquement cette entrée de l'historique
        history.splice(index, 1);
        await chrome.storage.local.set({ [HISTORY_KEY]: history });

        sendResponse({ ok: true });
        return;
      }

      // ----- RESOLVE ANIME (popup + automark) -----
      if (msg?.type === "RESOLVE_ANIME") {
        const title = String(msg?.title || msg?.query || "").trim();
        const seasonHint = msg?.season ?? msg?.seasonHint ?? null;
        const limit = Number.isFinite(msg?.limit) ? msg.limit : 6;

        logger.info("RESOLVE_ANIME", { title, seasonHint, limit });

        const r = await resolveAnimeCore({ title, seasonHint, limit });

        logger.info("RESOLVE_ANIME résultat", {
          ok: r.ok,
          found: r.found,
          bestScore: r.best?.score ?? null,
          bestTitle: r.best?.matchedOn ?? null,
          tried: r.tried,
        });

        sendResponse(r);
        return;
      }

      sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
    } catch (err) {
      logger.error("Erreur interne background", {
        message: err?.message,
        stack: err?.stack,
      });
      sendResponse({ ok: false, error: "INTERNAL_ERROR" });
    }
  })();

  return true; // async response
});
