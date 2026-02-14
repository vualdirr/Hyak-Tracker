// E:\Hyak-Tracker\src\popup\views\episode.js
import { setView } from "./viewState.js";
import { getSettings, applyDebugVisibilityFromSettings } from "./settings.js";
import {
  getToken,
  getStreamContext,
  sendMessage,
} from "../services/runtime.js";
import { pushLog } from "../services/runtime.js";
import { renderPopupLogs } from "./logs.js";

const $ = (id) => document.getElementById(id);

// -------------------- État local (vue épisode) --------------------
let booted = false;

let selectedAnimeId = null;
let currentDomain = null;
let pageCtx = null;

let hykToken = null;
let hykUid = null;

let selectedAnimeMedia = null; // media issu de /progression/anime/:uid/:id
let selectedAnimeProgressionRow = null; // progression serveur complète (startDate/endDate/lastChange/status...)
let knownProgression = null; // progression actuelle côté serveur (number | null)
let knownTotalEpisodes = null; // NbEpisodes (number | null)

const progCache = new Map(); // key `${uid}:${animeId}` -> data

const STORAGE_KEYS = {
  SETTINGS: "settings",
  AUTO_LEGACY: "autoMarkEnabled",
  UID: "hyakanimeUid",
  MAP: "animeLinkMap",
};

// -------------------- Public API --------------------
export async function renderEpisodeView(pctx) {
  setView("episode");
  activeTabId = pctx.tabId || null;
  await refreshEpisodeLogsUI();

  // init settings UI (debug visibility)
  try {
    await getSettings();
    await applyDebugVisibilityFromSettings();
  } catch {}

  // (re)bind listeners une seule fois
  if (!booted) {
    booted = true;
    bindEpisodeInputListeners();
    bindSearchWriteListeners();
  }

  // domain
  currentDomain = pctx.hostname || currentDomain;

  // ctx streaming (tab-scoped)
  const ctx = pctx.tabId ? await getStreamContext(pctx.tabId) : null;
  if (ctx) {
    pageCtx = ctx;
    currentDomain = ctx.domain || currentDomain;

    if (ctx.title) $("title").value = ctx.title;
    if (ctx.episode) $("episode").value = ctx.episode;

    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ctx.title || "—",
      episode: ctx.episode || "",
      season: ctx.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });

    updateWriteButtonState();
  } else {
    // Pas de ctx => on reste en mode manuel, mais on garde la vue épisode
    renderBanner({
      media: null,
      titleFallback: ($("title")?.value || "").trim() || "—",
      episode: ($("episode")?.value || "").trim(),
      season: "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });
    showSearchButton(true);
    log("ℹ️ Contexte streaming non disponible (mode manuel).");
  }

  // Token Hyakanime
  await ensureTokenAndUid();

  // Si pas de pageCtx, on autorise la recherche manuelle
  pageCtx = pageCtx || ctx;

  // Si titre absent => mode manuel
  if (!hasTitle()) {
    showSearchButton(true);
    log("ℹ️ Titre manquant. Saisis un titre puis recherche.");
  }

  // Si épisode absent => on peut chercher mais pas écrire
  if (!hasEpisode()) {
    $("btnWrite").disabled = true;
    showSearchButton(true);
    log("ℹ️ Épisode non détecté (ou vide).");
  }

  // Auto-search si titre OK
  if (hasTitle()) {
    await runHyakanimeSearch({ manual: false });
  }

  // Poll (temporaire) : refresh ctx si la page change d’épisode (SPA)
  // (on optimisera après en supprimant ce setInterval)
  if (pctx.tabId) {
    startCtxPolling(pctx.tabId);
  }
}

// -------------------- Polling ctx (temporaire) --------------------
let pollTimer = null;

function startCtxPolling(tabId) {
  if (pollTimer) return;

  pollTimer = setInterval(async () => {
    const ctx = await getStreamContext(tabId);
    if (!ctx) return;

    const changed =
      !pageCtx ||
      ctx.title !== pageCtx.title ||
      String(ctx.episode) !== String(pageCtx.episode) ||
      String(ctx.season) !== String(pageCtx.season);

    if (!changed) return;

    pageCtx = ctx;
    currentDomain = ctx.domain || currentDomain;

    if (ctx.title) $("title").value = ctx.title;
    if (ctx.episode) $("episode").value = ctx.episode;

    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ctx.title || "—",
      episode: ctx.episode || "",
      season: ctx.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });

    updateWriteButtonState();
  }, 1000);
}

// -------------------- Listeners --------------------
function bindEpisodeInputListeners() {
  $("episode")?.addEventListener("input", () => {
    updateWriteButtonState();
    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ($("title")?.value || "").trim() || "—",
      episode: ($("episode")?.value || "").trim(),
      season: pageCtx?.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });
  });
}

function bindSearchWriteListeners() {
  $("btnSearch")?.addEventListener("click", async () => {
    await runHyakanimeSearch({ manual: true });
  });

  $("btnWrite")?.addEventListener("click", async () => {
    const ep = parseInt($("episode")?.value || "", 10);
    if (!selectedAnimeId || !Number.isFinite(ep)) {
      return log("Il faut un animeId + un numéro d’épisode.");
    }

    // 🔒 Anti-downgrade + évite requête inutile si déjà vu
    if (Number.isFinite(knownProgression) && knownProgression >= ep) {
      updateWriteButtonState();
      return log(
        `🔒 Déjà vu: ta progression Hyakanime est à l'épisode ${knownProgression}. (Aucune action nécessaire)`,
      );
    }

    const nowISO = new Date().toISOString();

    const total = Number.isFinite(knownTotalEpisodes)
      ? knownTotalEpisodes
      : Number.isFinite(selectedAnimeMedia?.totalEpisodes)
        ? selectedAnimeMedia.totalEpisodes
        : null;

    // statut diffusion animé: 1=en cours, 2=prochainement, 3=terminé
    const isAnimeFinished = selectedAnimeMedia?.status === 3;

    const base = selectedAnimeProgressionRow
      ? { ...selectedAnimeProgressionRow }
      : {};

    const payload = {
      id: selectedAnimeId,
      animeID: selectedAnimeId,
      progression: ep,
      status: 1,

      ...(base.lastChange != null ? { lastChange: base.lastChange } : {}),
      ...(base.startDate != null ? { startDate: base.startDate } : {}),
      ...(base.endDate != null ? { endDate: base.endDate } : {}),
    };

    if (ep === 1 && !payload.startDate) {
      payload.startDate = nowISO;
    }

    if (
      total != null &&
      total > 0 &&
      ep === total &&
      isAnimeFinished &&
      !payload.endDate
    ) {
      if (!payload.startDate && base.startDate) {
        payload.startDate = base.startDate;
      }
      payload.endDate = nowISO;
      payload.status = 3;
    }

    log("Envoi progression:\n" + JSON.stringify(payload, null, 2));

    const res = await sendMessage({
      type: "WRITE_PROGRESSION",
      ...payload,
    });

    if (!res?.ok) {
      return log(
        `Erreur write (${res?.status || "?"}): ${JSON.stringify(res?.error || res)}`,
      );
    }

    log("✅ Progression mise à jour.");

    if (!Number.isFinite(knownProgression) || ep > knownProgression) {
      knownProgression = ep;
    }

    updateWriteButtonState();
    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ($("title")?.value || "").trim() || "—",
      episode: ($("episode")?.value || "").trim(),
      season: pageCtx?.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });
  });
}

// -------------------- Token / UID --------------------
async function ensureTokenAndUid() {
  const t = await getToken();

  if (!t?.token) {
    log(
      "⚠️ Pas de token Hyakanime. Ouvre Hyakanime (connecté) dans un onglet puis réessaie.",
    );
    return;
  }

  hykToken = t.token;
  const payload = safeDecodeJwtPayload(hykToken);
  hykUid = payload?.uid || payload?._id || payload?.sub || null;

  if (hykUid) {
    await chrome.storage.local.set({ [STORAGE_KEYS.UID]: hykUid });
    log("✅ Token Hyakanime détecté (uid OK).");
  } else {
    log("⚠️ Token détecté mais uid introuvable dans le payload (uid/_id/sub).");
  }
}

function safeDecodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;

    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );

    return JSON.parse(json);
  } catch {
    return null;
  }
}

// -------------------- UI / State --------------------
function hasTitle() {
  return !!($("title")?.value || "").trim();
}

function hasEpisode() {
  return !!($("episode")?.value || "").trim();
}

function showSearchButton(show) {
  $("btnSearch")?.classList.toggle("hidden", !show);
}

function updateWriteButtonState() {
  const ep = parseInt($("episode")?.value || "", 10);
  const btn = $("btnWrite");

  let disabled = !selectedAnimeId || !hasEpisode();
  let label = "Marquer “vu”";
  let title = "";

  if (
    !disabled &&
    Number.isFinite(ep) &&
    Number.isFinite(knownProgression) &&
    knownProgression >= ep
  ) {
    disabled = true;
    label = "Déjà vu";
    title = `Progression Hyakanime : épisode ${knownProgression}`;
  }

  btn.disabled = disabled;
  btn.textContent = label;
  btn.title = title;
}

// -------------------- Search / Ranking --------------------
function buildSearchQueries(title, seasonHint) {
  const q = String(title || "").trim();
  const n = parseInt(seasonHint, 10);

  if (!Number.isFinite(n) || n <= 1) return [q];
  return [`${q} saison ${n}`, `${q} season ${n}`, `${q} s${n}`, q];
}

async function runHyakanimeSearch({ manual }) {
  selectedAnimeId = null;
  selectedAnimeMedia = null;
  selectedAnimeProgressionRow = null;
  knownProgression = null;
  knownTotalEpisodes = null;

  updateWriteButtonState();
  clearChoices();

  const title = ($("title")?.value || "").trim();
  if (!title) {
    showSearchButton(true);
    return log("Entre un titre valide pour rechercher l’animé.");
  }

  const seasonHint = pageCtx?.season ? parseInt(pageCtx.season, 10) : null;
  const queries = buildSearchQueries(title, seasonHint);

  let allItems = [];
  const seen = new Set();

  for (const q of queries) {
    const res = await sendMessage({ type: "SEARCH_ANIME", query: q });
    if (!res?.ok) continue;

    const items = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.data)
        ? res.data.data
        : Array.isArray(res.data?.results)
          ? res.data.results
          : [];

    for (const it of items) {
      const id = it?.id;
      if (id == null) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      allItems.push(it);
    }
  }

  if (!allItems.length) {
    showSearchButton(true);
    return log("Aucun résultat Hyakanime. Modifie le titre puis relance.");
  }

  let ranked = rank(allItems, title).slice(0, 6);
  if (!ranked.length) {
    showSearchButton(true);
    return log("Aucun résultat exploitable (ranking vide).");
  }

  if (Number.isFinite(seasonHint) && seasonHint > 1) {
    const sTok = String(seasonHint);

    ranked.sort((a, b) => {
      const aHas =
        norm(a.matchedOn || "").includes(`saison ${sTok}`) ||
        norm(a.matchedOn || "").includes(`season ${sTok}`) ||
        norm(a.matchedOn || "").includes(`s${sTok}`);
      const bHas =
        norm(b.matchedOn || "").includes(`saison ${sTok}`) ||
        norm(b.matchedOn || "").includes(`season ${sTok}`) ||
        norm(b.matchedOn || "").includes(`s${sTok}`);

      if (aHas !== bHas) return aHas ? -1 : 1;
      return b.score - a.score;
    });
  }

  if (Number.isFinite(seasonHint) && seasonHint > 1) {
    const rootNorm = norm(title);
    const filtered = ranked.filter((r) => norm(r.matchedOn || "") !== rootNorm);
    if (filtered.length) ranked = filtered;
  }

  if (ranked[0]?.perfect) {
    await selectAnime(ranked[0].it);
    showSearchButton(false);
    clearChoices();
    log(`✅ Match parfait sur: ${ranked[0].matchedOn}`);
    return;
  }

  if (!manual && ranked[0].score < 0.72) {
    showSearchButton(true);
    renderChoices(ranked);
    log(
      `Debug match: best on "${ranked[0].matchedOn}" score=${(ranked[0].score * 100).toFixed(0)}%`,
    );
    log(
      `⚠️ Match incertain (${(ranked[0].score * 100).toFixed(0)}%). Choisis un résultat ou ajuste le titre.`,
    );
    return;
  }

  await selectAnime(ranked[0].it);
  showSearchButton(false);
  renderChoices(ranked);
}

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\[\(].*?[\]\)]/g, " ")
    .replace(/(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function rank(items, query) {
  const q = norm(query);

  const ranked = items.map((it) => {
    const titles = getAllTitles(it)
      .map((raw) => ({ raw, n: norm(raw) }))
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

// -------------------- Choices UI --------------------
function clearChoices() {
  $("choices").innerHTML = "";
}

function renderChoices(ranked) {
  clearChoices();
  ranked.forEach(({ it, score }) => {
    const btn = document.createElement("button");
    btn.className = "choiceBtn";

    const display =
      it.displayTitle ||
      it.titles?.fr ||
      it.titles?.en ||
      it.titles?.romaji ||
      it.titles?.jp ||
      it.title ||
      it.titleEN ||
      it.romanji ||
      it.titleJP ||
      "(sans titre)";

    btn.textContent = `Choisir ${(score * 100).toFixed(0)}% — ${display.slice(0, 36)}`;
    btn.addEventListener("click", () => selectAnime(it));
    $("choices").appendChild(btn);
  });
}

// -------------------- LinkMap (animeId cache) --------------------
function makeAnimeKey(title, season) {
  const s = Number.isFinite(season) && season > 0 ? season : 1;
  return `${norm(title)}|s${s}`;
}

async function upsertAnimeLink(title, season, animeId) {
  const key = makeAnimeKey(title, season);
  const s = await chrome.storage.local.get(STORAGE_KEYS.MAP);
  const map = s[STORAGE_KEYS.MAP] || {};
  map[key] = { animeId, titleRaw: title, season: season ?? 1, ts: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.MAP]: map });
}

// -------------------- Anime selection + progression fetch --------------------
async function selectAnime(anime) {
  selectedAnimeId = anime?.id ?? null;

  try {
    const titleForKey = ($("title")?.value || "").trim();
    const seasonForKey = pageCtx?.season ? parseInt(pageCtx.season, 10) : 1;

    if (titleForKey && selectedAnimeId) {
      await upsertAnimeLink(titleForKey, seasonForKey, selectedAnimeId);
    }
  } catch {}

  selectedAnimeMedia = null;
  selectedAnimeProgressionRow = null;
  knownProgression = null;
  knownTotalEpisodes = null;

  updateWriteButtonState();

  renderBanner({
    media: null,
    titleFallback:
      (
        anime?.title ||
        anime?.titleEN ||
        anime?.romanji ||
        anime?.titleJP ||
        $("title")?.value ||
        ""
      ).trim() || "—",
    episode: ($("episode")?.value || "").trim(),
    season: pageCtx?.season || "",
    currentProgression: null,
    totalEpisodes: null,
  });

  if (!selectedAnimeId) return;

  if (!hykUid) {
    log("ℹ️ Détails progression non chargés: uid manquant.");
    return;
  }

  try {
    const data = await fetchProgressionAnime(hykUid, selectedAnimeId);

    selectedAnimeMedia = data?.media ?? null;
    selectedAnimeProgressionRow = data?.progress ?? null;

    knownProgression = Number.isFinite(data?.progress?.currentEpisode)
      ? data.progress.currentEpisode
      : null;

    knownTotalEpisodes = Number.isFinite(data?.media?.totalEpisodes)
      ? data.media.totalEpisodes
      : null;

    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ($("title")?.value || "").trim() || "—",
      episode: ($("episode")?.value || "").trim(),
      season: pageCtx?.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });

    updateWriteButtonState();

    const t = getDisplayTitleMedia(selectedAnimeMedia);
    if (Number.isFinite(knownProgression));
    if (Number.isFinite(knownTotalEpisodes));
  } catch (e) {
    log(`⚠️ Impossible de charger la progression: ${String(e?.message || e)}`);
  }
}

async function fetchProgressionAnime(uid, animeId) {
  const key = `${uid}:${animeId}`;
  if (progCache.has(key)) return progCache.get(key);

  const res = await sendMessage({
    type: "GET_PROGRESSION_ANIME",
    uid,
    animeId,
  });

  if (!res?.ok) {
    throw new Error(
      `GET_PROGRESSION_ANIME failed: ${res?.status || "?"} (${res?.error || "unknown"})`,
    );
  }

  progCache.set(key, res.data);
  return res.data;
}

// -------------------- Banner rendering (copié/compatible) --------------------
function getDisplayTitleMedia(m) {
  return (
    (m?.displayTitle || "").trim() ||
    (m?.titles?.fr || "").trim() ||
    (m?.titles?.romaji || "").trim() ||
    (m?.titles?.en || "").trim() ||
    (m?.titles?.jp || "").trim() ||
    "—"
  );
}

function getAnimeDiffusionStatus(media) {
  const s = media?.status;
  if (s === 1) return { label: "En cours", cls: "pill--blue" };
  if (s === 2) return { label: "Prochainement", cls: "pill--yellow" };
  if (s === 3) return { label: "Terminé", cls: "pill--green" };
  return { label: "Inconnu", cls: "pill--muted" };
}

function setPill(el, { label, cls }) {
  if (!el) return;
  el.textContent = label;

  el.classList.remove(
    "pill--blue",
    "pill--yellow",
    "pill--green",
    "pill--muted",
  );
  el.classList.add("pill", cls);
  el.classList.toggle("hidden", !label);
}

function renderBanner({
  media,
  titleFallback,
  episode,
  season,
  currentProgression,
  totalEpisodes,
} = {}) {
  const bannerTitleEl = $("bannerTitle");
  const bannerSubEl = $("bannerSub");
  const animeStatusEl = $("animeStatusPill");
  const bannerBgEl = $("bannerBg");
  const posterEl = $("poster");
  const pageDomainEl = $("pageDomain");

  if (pageDomainEl) pageDomainEl.textContent = currentDomain || "—";

  if (media) {
    setPill(animeStatusEl, getAnimeDiffusionStatus(media));
  } else if (animeStatusEl) {
    animeStatusEl.classList.add("hidden");
  }

  const title = media ? getDisplayTitleMedia(media) : titleFallback || "—";
  bannerTitleEl.textContent = title;

  const parts = [];
  if (season) parts.push(`Saison ${season}`);
  if (episode) parts.push(`Épisode ${episode}`);

  const p = Number.isFinite(currentProgression) ? currentProgression : null;
  const tEp = Number.isFinite(totalEpisodes) ? totalEpisodes : null;

  if (p != null && tEp != null && tEp > 0) {
    parts.push(`Progression ${p}/${tEp}`);
  } else if (p != null) {
    parts.push(`Progression ${p}`);
  } else if (tEp != null && tEp > 0) {
    parts.push(`${tEp} épisodes`);
  }

  bannerSubEl.textContent = parts.length
    ? parts.join(" • ")
    : "Sélectionne un animé…";

  const bannerImg = media?.bannerUrl || "";
  const posterImg = media?.posterUrl || "";

  bannerBgEl.style.backgroundImage = bannerImg ? `url("${bannerImg}")` : "";
  posterEl.src = posterImg || "";
  posterEl.style.display = posterImg ? "block" : "none";
}

// -------------------- Logs (global) --------------------
let activeTabId = null;

async function refreshEpisodeLogsUI() {
  const el = $("log");
  if (!el) return;
  if (!activeTabId) return;
  await renderPopupLogs({ tabId: activeTabId, el });
}

function log(message, data) {
  // On envoie un STEP (milestone)
  pushLog({
    tabId: activeTabId,
    level: "info",
    kind: "step",
    scope: "popup:episode",
    message: String(message || ""),
    data,
  }).catch(() => {});

  // refresh UI (best effort)
  refreshEpisodeLogsUI().catch(() => {});
}

function logSettings(message, data) {
  pushLog({
    tabId: activeTabId,
    level: "info",
    kind: "step",
    scope: "popup:settings",
    message: String(message || ""),
    data,
  }).catch(() => {});

  const el = $("logSettings");
  if (el) {
    // logSettings reste dans son <pre> uniquement si debug visible,
    // mais on peut aussi l’afficher via store global plus tard.
    el.textContent = (String(message || "") + "\n\n" + el.textContent).slice(
      0,
      2000,
    );
  }
}
