// E:\Hyak-Tracker\src\core\logger.js
//
// doc du logger -> \Hyak-Tracker\docs\logger.md
let debugEnabledCache = null;
let debugInitPromise = null;

async function initDebugCache() {
  if (debugInitPromise) return debugInitPromise;

  debugInitPromise = (async () => {
    try {
      const { settings } = await chrome.storage.local.get(["settings"]);
      debugEnabledCache = !!settings?.debug;
    } catch {
      debugEnabledCache = false;
    }

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (!changes?.settings) return;
        debugEnabledCache = !!changes.settings?.newValue?.debug;
      });
    } catch {
      // ignore
    }
  })();

  return debugInitPromise;
}

function isDebugEnabled() {
  return !!debugEnabledCache;
}

function safeSerializable(value) {
  try {
    const seen = new WeakSet();
    return JSON.parse(
      JSON.stringify(value, (_k, v) => {
        if (typeof v === "function") return "[function]";
        if (typeof v === "bigint") return String(v);
        if (v && typeof v === "object") {
          if (seen.has(v)) return "[circular]";
          seen.add(v);
        }
        return v;
      }),
    );
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

async function pushToBackground(payload) {
  try {
    await chrome.runtime.sendMessage({
      type: "LOG_PUSH",
      ...payload,
    });
  } catch {
    // never break app
  }
}

function printToConsole(level, kind, scope, message, data) {
  const dbg = isDebugEnabled();

  // ✅ Matrice validée:
  // debug OFF => uniquement error (pas de step)
  if (!dbg) {
    if (level !== "error") return;
    if (kind === "step") return;
  }

  const prefix = scope ? `[Hyak:${scope}]` : "[Hyak]";
  const line = message ? `${prefix} ${message}` : prefix;

  try {
    // step: on l'affiche comme info (console.log) quand debug ON
    if (kind === "step") {
      console.log(line, data ?? "");
      return;
    }

    if (level === "error") console.error(line, data ?? "");
    else if (level === "warn") console.warn(line, data ?? "");
    else if (level === "debug") console.debug(line, data ?? "");
    else console.log(line, data ?? "");
  } catch {
    // ignore
  }
}

export function createLogger({
  scope = "app",
  // compat ancien nom: siteKey
  originHost = "",
  siteKey = "",
  originUrl = "",
  url = "",
  tabId = null,
} = {}) {
  initDebugCache().catch(() => {});

  const finalOriginHost = String(originHost || siteKey || "");
  const finalOriginUrl = String(originUrl || url || "");

  function emit({ level, kind = "log", message, data }) {
    const payload = {
      level,
      kind,
      scope,
      message: String(message || ""),
      data: data !== undefined ? safeSerializable(data) : undefined,

      // IMPORTANT:
      // originHost = hostname du contexte qui log (iframe ou top frame)
      // background mergera tout dans la session du tab (top host)
      originHost: finalOriginHost,
      originUrl: finalOriginUrl,

      tabId: tabId ?? undefined,
    };

    pushToBackground(payload).catch(() => {});
    printToConsole(level, kind, scope, payload.message, payload.data);
  }

  return {
    debug: (message, data) =>
      emit({ level: "debug", kind: "log", message, data }),
    info: (message, data) =>
      emit({ level: "info", kind: "log", message, data }),
    warn: (message, data) =>
      emit({ level: "warn", kind: "log", message, data }),
    error: (message, data) =>
      emit({ level: "error", kind: "log", message, data }),

    // ⭐ Milestones (popup)
    // - stocké toujours
    // - console uniquement si debug ON (géré par printToConsole)
    step: (message, ui) =>
      emit({ level: "info", kind: "step", message, data: ui }),
  };
}
