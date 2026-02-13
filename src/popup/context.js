import { getActiveTab } from "./services/tabs.js";
import { getStreamContext } from "./services/runtime.js";

const STREAMING_HOSTS = new Set([
  "anime-sama.tv",
  "voiranime.com",
  "v6.voiranime.com",
]);

function hostIsSupported(hostname) {
  if (!hostname) return false;
  if (STREAMING_HOSTS.has(hostname)) return true;
  // sous-domaines anime-sama / voiranime
  if (hostname.endsWith(".anime-sama.tv")) return true;
  if (hostname.endsWith(".voiranime.com")) return true;
  return false;
}

function isRootPath(url) {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}

export async function resolvePopupContext() {
  const tab = await getActiveTab();

  const url = tab?.url || "";
  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  const supported = hostIsSupported(hostname);
  const root = supported && isRootPath(url);

  const ctx = tab?.id ? await getStreamContext(tab.id) : null;

  return {
    tabId: tab?.id ?? null,
    url,
    hostname,
    supported,
    isRoot: root,
    streamCtx: ctx, // { title, season, episode, ... } ou null
  };
}
