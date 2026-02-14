// E:\Hyak-Tracker\src\popup\views\settings.js
import { setView } from "./viewState.js";
import { getActiveTab } from "../services/tabs.js";
import { getCurrentLogs } from "../services/runtime.js";

const $ = (id) => document.getElementById(id);

const STORAGE_KEYS = {
  SETTINGS: "settings",
  AUTO_LEGACY: "autoMarkEnabled",
};

const DEFAULT_SETTINGS = {
  autoMark: false,
  debug: false,
  qoe: true,
};

let handlersBound = false;
let returnView = "episode";

export function initSettingsHandlers() {
  if (handlersBound) return;
  handlersBound = true;

  $("btnBack")?.addEventListener("click", () => {
    setView(returnView || "episode");
  });

  $("toggleAutoMark")?.addEventListener("click", async () => {
    const s = await getSettings();
    const next = !s.autoMark;
    await updateSettings({ autoMark: next });
    await syncSettingsUI();
    logSettings(
      next ? "✅ Marquage auto activé." : "⛔ Marquage auto désactivé.",
    );
  });

  $("toggleDebug")?.addEventListener("click", async () => {
    const s = await getSettings();
    const next = !s.debug;
    await updateSettings({ debug: next });
    await syncSettingsUI();
    applyDebugVisibility(next);
    logSettings(next ? "✅ Mode debug activé." : "⛔ Mode debug désactivé.");
  });

  // ----- Clipboard logs (toujours disponibles; debug = visuel uniquement) -----
  $("btnCopyLogs")?.addEventListener("click", async () => {
    try {
      const tab = await getActiveTab();
      const tabId = tab?.id ?? null;
      if (!tabId) {
        logSettings("❌ Impossible de déterminer l’onglet actif.");
        return;
      }

      const res = await getCurrentLogs(tabId);
      if (!res?.ok) {
        logSettings("❌ Impossible de récupérer les logs.");
        return;
      }

      const text = formatLogsForClipboard({
        tabId,
        url: tab?.url || "",
        siteKey: res.siteKey || "",
        logs: res.logs || [],
      });

      await navigator.clipboard.writeText(text);
      logSettings("📋 Logs copiés dans le presse-papiers.");
    } catch (e) {
      logSettings("❌ Échec copie presse-papiers : " + String(e?.message || e));
    }
  });
}

export async function openSettings(fromView) {
  returnView = fromView || "episode";
  setView("settings");
  await syncSettingsUI();
  await applyDebugVisibilityFromSettings();
  logSettings("ℹ️ Paramètres ouverts.");
}

export async function getSettings() {
  const s = await chrome.storage.local.get([
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.AUTO_LEGACY,
  ]);

  const cur = s[STORAGE_KEYS.SETTINGS];
  if (cur && typeof cur === "object") {
    return {
      ...DEFAULT_SETTINGS,
      ...cur,
      autoMark: !!cur.autoMark,
      debug: !!cur.debug,
      qoe: !!cur.qoe,
    };
  }

  // migration legacy autoMarkEnabled -> settings.autoMark
  const legacyAuto = s[STORAGE_KEYS.AUTO_LEGACY];
  const migrated = { ...DEFAULT_SETTINGS, autoMark: !!legacyAuto };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: migrated });
  return migrated;
}

export async function updateSettings(patch) {
  const cur = await getSettings();
  const next = {
    ...cur,
    ...patch,
    autoMark: patch?.autoMark != null ? !!patch.autoMark : !!cur.autoMark,
    debug: patch?.debug != null ? !!patch.debug : !!cur.debug,
    qoe: patch?.qoe != null ? !!patch.qoe : !!cur.qoe,
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });

  // compat legacy
  if (patch?.autoMark != null) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.AUTO_LEGACY]: !!next.autoMark,
    });
  }

  return next;
}

function setToggleButton(el, enabled) {
  if (!el) return;
  el.textContent = enabled ? "ON" : "OFF";
  el.title = enabled ? "Désactiver" : "Activer";
}

export async function syncSettingsUI() {
  const s = await getSettings();
  setToggleButton($("toggleAutoMark"), !!s.autoMark);
  setToggleButton($("toggleDebug"), !!s.debug);
}

export function applyDebugVisibility(enabled) {
  $("log")?.classList.toggle("hidden", !enabled);
  $("logSettings")?.classList.toggle("hidden", !enabled);
  $("logRoot")?.classList.toggle("hidden", !enabled);
  $("logUnsupported")?.classList.toggle("hidden", !enabled);
}

export async function applyDebugVisibilityFromSettings() {
  const s = await getSettings();
  applyDebugVisibility(!!s.debug);
}

function logSettings(s) {
  const el = $("logSettings");
  if (!el) return;
  el.textContent = (String(s) + "\n\n" + el.textContent).slice(0, 4000);
}

function formatLogsForClipboard({ tabId, url, siteKey, logs }) {
  const header = [
    "Hyak Tracker — Logs",
    `Date: ${new Date().toISOString()}`,
    `TabId: ${tabId}`,
    `Site: ${siteKey || "—"}`,
    `URL: ${url || "—"}`,
    `Count: ${Array.isArray(logs) ? logs.length : 0}`,
    "",
  ].join("\n");

  if (!Array.isArray(logs) || logs.length === 0) {
    return header + "Aucun log disponible.\n";
  }

  const lines = logs.map((l) => {
    const ts = l?.ts ? new Date(l.ts).toISOString() : "";
    const level = String(l?.level || "info").toUpperCase();
    const scope = String(l?.scope || "app");
    const msg = String(l?.message || "");

    let data = "";
    if (l?.data !== undefined) {
      try {
        data = JSON.stringify(l.data);
      } catch {
        data = "[unserializable]";
      }
    }

    return data
      ? `[${ts}] ${level} ${scope} — ${msg} | ${data}`
      : `[${ts}] ${level} ${scope} — ${msg}`;
  });

  return header + lines.join("\n") + "\n";
}
