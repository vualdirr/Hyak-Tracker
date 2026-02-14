// E:\Hyak-Tracker\src\popup\views\logs.js
import { getCurrentLogs } from "../services/runtime.js";

const MAX_CHARS = 4000;

function toLine(l) {
  const ts = l?.ts ? new Date(l.ts).toISOString() : "";
  const level = String(l?.level || "info").toUpperCase();
  const kind = String(l?.kind || "log");
  const scope = String(l?.scope || "app");
  const msg = String(l?.message || "");

  // data compact
  let data = "";
  if (l?.data !== undefined) {
    try {
      data = JSON.stringify(l.data);
    } catch {
      data = "[unserializable]";
    }
  }

  const tag = kind === "step" ? "STEP" : level;
  return data
    ? `[${ts}] ${tag} ${scope} — ${msg} | ${data}`
    : `[${ts}] ${tag} ${scope} — ${msg}`;
}

function filterForPopup(logs) {
  if (!Array.isArray(logs)) return [];
  return logs.filter((l) => l?.kind === "step" || l?.level === "error");
}

export async function renderPopupLogs({ tabId, el }) {
  if (!el) return;

  if (!tabId) {
    el.textContent = "Logs indisponibles (tabId manquant).";
    return;
  }

  const res = await getCurrentLogs(tabId);
  if (!res?.ok) {
    el.textContent = "Logs indisponibles (LOG_GET_CURRENT failed).";
    return;
  }

  const filtered = filterForPopup(res.logs || []);
  if (filtered.length === 0) {
    el.textContent = "Aucun log (step/error) pour cet onglet.";
    return;
  }

  // on affiche les plus récents en haut
  const lines = filtered
    .slice()
    .sort((a, b) => (b?.ts ?? 0) - (a?.ts ?? 0))
    .map(toLine);

  el.textContent = lines.join("\n").slice(0, MAX_CHARS);
}
