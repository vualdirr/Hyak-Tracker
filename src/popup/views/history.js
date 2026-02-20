// E:\Hyak-Tracker\src\popup\views\history.js
import { setView, getView } from "./viewState.js";
import { applyDebugVisibilityFromSettings } from "./settings.js";
import { sendMessage, pushLog } from "../services/runtime.js";
import { renderPopupLogs } from "./logs.js";

const $ = (id) => document.getElementById(id);

let returnView = "episode";
let wired = false;

export async function openHistory(fromView, { tabId } = {}) {
  returnView = fromView || getView() || "episode";

  // pour logs (best effort)
  if (tabId) window.__activeTabId = tabId;

  setView("history");
  await applyDebugVisibilityFromSettings();

  try {
    const el = $("logHistory");
    if (window.__activeTabId && el) {
      await renderPopupLogs({ tabId: window.__activeTabId, el });
    }
  } catch {}

  if (!wired) {
    wireHandlers();
    wired = true;
  }

  await renderHistoryList();
}

function wireHandlers() {
  $("btnBackHistory")?.addEventListener("click", () => {
    setView(returnView || "episode");
  });
}

async function renderHistoryList() {
  const box = $("historyList");
  if (!box) return;

  box.innerHTML = `<div class="settingsHint">Chargement…</div>`;

  const res = await sendMessage({ type: "HISTORY_GET" });

  if (!res?.ok) {
    box.innerHTML = `<div class="settingsHint">Erreur chargement historique.</div>`;
    return;
  }

  const list = Array.isArray(res.history) ? res.history : [];

  if (!list.length) {
    box.innerHTML = `<div class="settingsHint">Aucune entrée pour le moment.</div>`;
    return;
  }

  box.innerHTML = "";

  // On récupère la session une seule fois
  const session = await sendMessage({ type: "GET_SESSION" });
  const uid = session?.ok && session.authenticated ? session.uid : null;

  // ✅ Lock UX par animeId : seule la 1ère occurrence (la plus récente) est annulable
  const seenAnime = new Set();

  const top10 = list.slice(0, 10);

  for (let index = 0; index < top10.length; index++) {
    const h = top10[index];

    const item = document.createElement("div");
    item.className = "historyRow";

    const dt = new Date(h.date);
    const diffLabel = `${h.oldEpisode ?? 0} → ${h.newEpisode}`;
    const tsLabel = dt.toLocaleString();

    let title = `Anime #${h.animeId ?? "?"}`;
    let posterUrl = "";

    if (uid && Number.isFinite(h.animeId)) {
      const mediaRes = await sendMessage({
        type: "GET_PROGRESSION_ANIME",
        uid,
        animeId: h.animeId,
      });

      if (mediaRes?.ok && mediaRes.data?.media) {
        const m = mediaRes.data.media;
        title =
          m.displayTitle ||
          m.titles?.fr ||
          m.titles?.romaji ||
          m.titles?.en ||
          m.titles?.jp ||
          title;

        posterUrl = m.posterUrl || "";
      }
    }

    const animeKey = String(h.animeId ?? "");
    const isUndoAllowed = animeKey && !seenAnime.has(animeKey);
    if (animeKey) seenAnime.add(animeKey);

    item.innerHTML = `
      <img class="historyPoster" src="${posterUrl || ""}" alt="" />
      <div class="historyBody">
        <div class="historyTitle">${escapeHtml(title)}</div>
        <div class="historyDiff">${escapeHtml(diffLabel)}</div>
        <div class="historyTs">${escapeHtml(tsLabel)}</div>
      </div>
      <button
        class="historyActionBtn"
        data-idx="${index}"
        ${isUndoAllowed ? "" : "disabled"}
        title="${
          isUndoAllowed
            ? "Annuler le dernier épisode de cet animé"
            : "Annule d'abord l'épisode le plus récent de cet animé"
        }"
      >
        Annuler
      </button>
    `;

    const img = item.querySelector("img.historyPoster");
    img?.addEventListener("error", () => {
      img.removeAttribute("src");
    });

    const btn = item.querySelector("button.historyActionBtn");
    btn?.addEventListener("click", async () => {
      const idx = Number(btn.getAttribute("data-idx"));

      const r = await sendMessage({ type: "HISTORY_UNDO_INDEX", index: idx });

      if (r?.ok) {
        pushLog({
          tabId: window.__activeTabId ?? null,
          level: "info",
          kind: "step",
          scope: "popup:history",
          message: "↩️ Undo réussi",
        }).catch(() => {});
        await renderHistoryList();
        return;
      }

      const msg =
        r?.error === "NOT_NEWEST_FOR_ANIME"
          ? "Tu dois d'abord annuler l'épisode le plus récent de cet animé."
          : r?.error === "STATE_MISMATCH"
            ? "Impossible : la progression actuelle ne correspond plus."
            : "Impossible d'annuler.";

      alert(msg);
    });

    box.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
