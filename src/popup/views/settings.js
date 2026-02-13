// E:\Hyak-Tracker\src\popup\views\settings.js
import { setView } from "./viewState.js";

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
