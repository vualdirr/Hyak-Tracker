// src/popup/views/root.js
import { applyDebugVisibilityFromSettings } from "./settings.js";
import { setView } from "./viewState.js";
import { setBannerBasic } from "../components/banner.js";
import { renderPopupLogs } from "./logs.js";
import { sendMessage, pushLog } from "../services/runtime.js";

const $ = (id) => document.getElementById(id);

export async function renderRootView(pctx) {
  setView("root");

  setBannerBasic({
    domain: pctx.hostname || "—",
    title: "Calendrier",
    subtitle: "Épisodes à venir",
  });

  await applyDebugVisibilityFromSettings();

  // Logs popup (steps + errors)
  const el = $("logRoot");
  await renderPopupLogs({ tabId: pctx.tabId, el });

  // Calendrier
  await renderUpcomingCalendar({ tabId: pctx.tabId });
}

// --------------------------------------------------
// Calendrier "épisodes à venir" (max 5)
// --------------------------------------------------

async function renderUpcomingCalendar({ tabId }) {
  const container = document.getElementById("calendarList");
  if (!container) return;

  container.innerHTML = `<div class="calendar-loading">Chargement...</div>`;

  const listRes = await sendMessage({ type: "GET_USER_PROGRESSION_LIST" });

  if (!listRes?.ok) {
    container.innerHTML = `<div class="calendar-error">Erreur chargement</div>`;
    pushLog({
      tabId,
      level: "error",
      kind: "step",
      scope: "popup:root",
      message: "Erreur calendrier: GET_USER_PROGRESSION_LIST",
      data: listRes,
    }).catch(() => {});
    return;
  }

  const list = Array.isArray(listRes.data) ? listRes.data : [];

  // ✅ En cours = progression.status === 1
  const inProgress = list.filter((row) => row?.progression?.status === 1);

  const upcoming = [];

  for (const row of inProgress) {
    const animeId = row?.progression?.animeID ?? row?.media?.id ?? null;
    const next = row?.nextEpisode;

    // nextEpisode: "" ou null => on ignore (comme tu l'as demandé)
    if (!animeId) continue;
    if (next == null || next === "") continue;

    const ts = Number(next);
    if (!Number.isFinite(ts) || ts <= 0) continue;

    const current = Number.isFinite(Number(row?.progression?.progression))
      ? Number(row.progression.progression)
      : 0;

    const title =
      (row?.media?.title ? String(row.media.title).trim() : "") ||
      (row?.media?.romanji ? String(row.media.romanji).trim() : "") ||
      (row?.media?.titleEN ? String(row.media.titleEN).trim() : "") ||
      (row?.media?.titleJP ? String(row.media.titleJP).trim() : "") ||
      `Anime #${animeId}`;

    upcoming.push({
      animeId,
      title,
      episodeNumber: current + 1,
      releaseDateTime: ts,
    });
  }

  if (!upcoming.length) {
    container.innerHTML = `<div class="calendar-empty">Aucun épisode à venir</div>`;
    return;
  }

  upcoming.sort((a, b) => a.releaseDateTime - b.releaseDateTime);
  const limited = upcoming.slice(0, 5);

  container.innerHTML = "";

  for (const item of limited) {
    const div = document.createElement("div");
    div.className = "calendar-item";

    const remaining = computeRemaining(item.releaseDateTime);

    div.innerHTML = `
      <div class="calendar-title">${escapeHtml(item.title)}</div>
      <div class="calendar-meta">
        Épisode ${item.episodeNumber}
        <span class="calendar-remaining">${remaining}</span>
      </div>
    `;

    div.addEventListener("click", () => {
      chrome.tabs.create({ url: `https://hyakanime.fr/anime/${item.animeId}` });
    });

    container.appendChild(div);
  }

  pushLog({
    tabId,
    level: "info",
    kind: "step",
    scope: "popup:root",
    message: "Calendrier chargé",
    data: { count: upcoming.length, shown: limited.length },
  }).catch(() => {});
}

function computeRemaining(ts) {
  const diff = ts - Date.now();

  if (diff <= 0) return "Disponible";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `J-${days}`;
  return `${hours}h`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
