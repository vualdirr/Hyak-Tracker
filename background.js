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

  const totalEpisodes = detail?.media?.totalEpisodes ?? null;

  const existingStatus = detail?.progress?.status ?? null; // 1..6
  const existingStart = detail?.progress?.startDate ?? null;
  const existingEnd = detail?.progress?.endDate ?? null;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // 2) Status commun
  // Rappel: 1=en cours, 2=à voir, 3=terminé, 4=en pause, 5=abandonné, 6=revisionnée
  let status = existingStatus ?? 1;

  const canDecideFinish = Number.isFinite(totalEpisodes) && totalEpisodes > 0;

  const willFinish = canDecideFinish && episode >= totalEpisodes;

  if (willFinish) {
    status = 3; // ✅ Terminé
  } else {
    // ✅ Option A: si on regarde, on force "en cours" pour 2/4/5
    // ❗ B: si status=6 (revisionnée), on ne touche pas
    if (episode >= 1 && (status === 2 || status === 4 || status === 5)) {
      status = 1;
    }
  }

  // 3) Extra commun (types compatibles API)
  // - lastChange: number (ms)
  // - startDate/endDate: ISO string
  const extra = {
    lastChange: nowMs,
  };

  if (!existingStart && episode >= 1) {
    extra.startDate = nowIso;
  }

  if (status === 3 && !existingEnd) {
    extra.endDate = nowIso;
  }

  // 4) writeSafe (anti-downgrade déjà géré côté API)
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

  return { ok: true, data: r.data };
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
          const q = `${ctx.title} saison ${season}`;
          logger.info("AUTOMARK mapping manquant → SEARCH_ANIME", {
            tabId,
            q,
            mapKey,
          });

          const sr = await hyakApi.search.anime(q);

          if (sr.ok && Array.isArray(sr.data) && sr.data.length > 0) {
            animeId = sr.data[0]?.id ?? null;
            animeId = Number.parseInt(animeId, 10);

            if (Number.isFinite(animeId)) {
              animeLinkMap[mapKey] = {
                animeId,
                season,
                titleRaw: ctx.title,
                ts: Date.now(),
                auto: true,
              };
              await chrome.storage.local.set({ animeLinkMap });
              logger.info("AUTOMARK mapping créé", { tabId, mapKey, animeId });
            }
          } else {
            logger.warn("AUTOMARK SEARCH_ANIME vide", {
              tabId,
              ok: sr.ok,
              len: sr.data?.length ?? 0,
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
            message: `🔒 Automark skip (déjà à ${wrData?.known})`,
          });
        } else {
          pushLog(tabId, {
            ts: Date.now(),
            level: "info",
            kind: "step",
            scope: "automark/bg",
            message: `✅ Automark progression mise à jour → ${ep}`,
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
