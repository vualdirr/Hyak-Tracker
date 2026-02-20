// E:\Hyak-Tracker\src\popup\views\episode.js
import { setView } from "./viewState.js";
import { getSettings, applyDebugVisibilityFromSettings } from "./settings.js";
import {
  getSession,
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
    wireBannerClick();
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

  // Session Hyakanime (LOCK GLOBAL)
  const sessionOk = await ensureSessionAndUidOrLockUI();
  if (!sessionOk) {
    // Pas de polling, pas de search auto, pas de progression.
    return;
  }

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

// -------------------- Session / UID (LOCK GLOBAL) --------------------
async function ensureSessionAndUidOrLockUI() {
  const session = await getSession();

  if (!session?.ok || !session.authenticated || !session.uid) {
    hykUid = null;

    // Désactivation complète des actions
    const btnSearch = $("btnSearch");
    const btnWrite = $("btnWrite");

    if (btnSearch) btnSearch.disabled = true;
    if (btnWrite) btnWrite.disabled = true;

    // Reset état progression
    selectedAnimeId = null;
    selectedAnimeMedia = null;
    selectedAnimeProgressionRow = null;
    knownProgression = null;
    knownTotalEpisodes = null;

    // Bannière explicite
    renderBanner({
      media: null,
      titleFallback: "Connexion requise",
      episode: "",
      season: "",
      currentProgression: null,
      totalEpisodes: null,
    });

    log(
      "🔒 Hyakanime non connecté. Ouvre Hyakanime (connecté) dans un onglet puis ré-ouvre le popup.",
    );

    return false;
  }

  hykUid = session.uid;

  log("✅ Session Hyakanime OK.");
  return true;
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

// -------------------- Search  --------------------
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

  // ✅ Centralisé dans le background
  const res = await sendMessage({
    type: "RESOLVE_ANIME",
    title,
    seasonHint,
    limit: 6,
  });

  if (!res?.ok) {
    showSearchButton(true);
    return log("Erreur RESOLVE_ANIME. Réessaye.");
  }

  if (!res?.found || !Array.isArray(res.ranked) || !res.ranked.length) {
    showSearchButton(true);
    return log("Aucun résultat Hyakanime. Modifie le titre puis relance.");
  }

  let ranked = res.ranked.slice(0, 6);

  // Perfect match
  if (ranked[0]?.perfect) {
    await selectAnime(ranked[0].it);
    showSearchButton(false);
    clearChoices();
    log(`✅ Match parfait sur: ${ranked[0].matchedOn}`);
    return;
  }

  // Match incertain en auto
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

  // Sélection auto du best + afficher choices
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
  wireBannerClick();

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

function wireBannerClick() {
  const banner = document.getElementById("banner");
  if (!banner) return;

  if (!selectedAnimeId) {
    banner.style.cursor = "";
    banner.onclick = null;
    return;
  }

  banner.style.cursor = "pointer";
  banner.onclick = () => {
    chrome.tabs.create({
      url: `https://hyakanime.fr/anime/${selectedAnimeId}`,
    });
  };
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
