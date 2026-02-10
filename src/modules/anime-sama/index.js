// src/modules/anime-sama/index.js
import { extractAnimeSamaContext } from "./extract.js";

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function publish(ctx, meta) {
  // cache pour popup (même fermé)
  await chrome.storage.local.set({
    lastDetected: ctx,
    lastDetectedMeta: { ts: Date.now(), ...meta },
  });

  // message temps réel (si tu l'utilises)
  chrome.runtime.sendMessage({
    type: "STREAM_UPDATE",
    payload: ctx,
    meta: { ts: Date.now(), ...meta },
  });
}

export default {
  id: "anime-sama",

  match(hostname) {
    return hostname === "anime-sama.tv" || hostname.endsWith(".anime-sama.tv");
  },

  async run(api) {
    api.log("anime-sama module attached");

    const fire = debounce(async (meta) => {
      const ctx = extractAnimeSamaContext();
      await publish(ctx, meta);
      api.log("ctx", ctx);
    }, 150);

    // 1) First extract
    fire({ kind: "init", reason: "startup" });

    // 2) Écoute changement d'épisode via le select
    const select = document.querySelector("#selectEpisodes");
    const onChange = () => fire({ kind: "change", reason: "selectEpisode" });
    if (select) select.addEventListener("change", onChange, { passive: true });

    // 3) Observer ciblé sur le select (au cas où le site modifie le DOM sans event)
    let mo = null;
    if (select) {
      mo = new MutationObserver(() =>
        fire({ kind: "mut", reason: "selectMutation" }),
      );
      mo.observe(select, { childList: true, subtree: true, attributes: true });
    }

    // Cleanup
    return () => {
      try {
        if (select) select.removeEventListener("change", onChange);
      } catch {}
      try {
        mo?.disconnect();
      } catch {}
      api.log("anime-sama module detached");
    };
  },
};
