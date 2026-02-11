// src/modules/voiranime/index.js
import { extractVoiranimeContext } from "./extract.js";

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function publish(ctx, meta) {
  await chrome.storage.local.set({
    lastDetected: ctx,
    lastDetectedMeta: { ts: Date.now(), ...meta },
  });

  chrome.runtime.sendMessage({
    type: "STREAM_UPDATE",
    payload: ctx,
    meta: { ts: Date.now(), ...meta },
  });
}

export default {
  id: "voiranime",

  match(hostname) {
    // cible v6.voiranime.com, mais aussi prêt si ça change en sous-domaine
    return (
      hostname === "v6.voiranime.com" || hostname.endsWith(".voiranime.com")
    );
  },

  async run(api) {
    api.log("voiranime module attached");

    const fire = debounce(async (meta) => {
      const ctx = extractVoiranimeContext();
      await publish(ctx, meta);
      api.log("ctx", ctx);
    }, 150);

    // 1) First extract
    fire({ kind: "init", reason: "startup" });

    // 2) Observer: le breadcrumb change quand on change d’épisode (SPA / DOM update)
    const root =
      document.querySelector("#manga-reading-nav-head") || document.body;

    const mo = new MutationObserver(() => {
      fire({ kind: "mut", reason: "breadcrumbMutation" });
    });

    mo.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    // 3) Petit “filet de sécurité” : si l’URL change sans mutation visible
    let lastHref = location.href;
    const urlTimer = setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        fire({ kind: "nav", reason: "urlChange" });
      }
    }, 500);

    // Cleanup
    return () => {
      try {
        mo.disconnect();
      } catch {}
      try {
        clearInterval(urlTimer);
      } catch {}
      api.log("voiranime module detached");
    };
  },
};
