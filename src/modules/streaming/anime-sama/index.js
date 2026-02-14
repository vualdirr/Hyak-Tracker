// src/modules/streaming/anime-sama/index.js
import { extractAnimeSamaContext } from "./extract.js";

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function publish(ctx, meta) {
  await chrome.runtime.sendMessage({
    type: "STREAM_UPDATE",
    payload: ctx,
    meta: { ts: Date.now(), ...meta },
  });
}

export default {
  id: "streaming/anime-sama",

  match(hostname) {
    return hostname === "anime-sama.tv" || hostname.endsWith(".anime-sama.tv");
  },

  async run(api) {
    api.log("anime-sama (streaming) module attached");

    const fire = debounce(async (meta) => {
      const ctx = extractAnimeSamaContext();
      await publish(ctx, meta);

      if (ctx?.title && ctx?.episode) {
        api.log("CTX OK", ctx); // debug interne
        await chrome.runtime.sendMessage({
          type: "LOG_PUSH",
          level: "info",
          kind: "step",
          scope: "streaming/anime-sama",
          message: `Contexte détecté: ${ctx.title} E${ctx.episode}`,
        });
      }
    }, 150);

    // 1) First extract
    fire({ kind: "init", reason: "startup" });

    // 2) Change episode via select
    const select = document.querySelector("#selectEpisodes");
    const onChange = () => fire({ kind: "change", reason: "selectEpisode" });
    if (select) select.addEventListener("change", onChange, { passive: true });

    // 3) Mutation observer on select (SPA quirks)
    let mo = null;
    if (select) {
      mo = new MutationObserver(() =>
        fire({ kind: "mut", reason: "selectMutation" }),
      );
      mo.observe(select, { childList: true, subtree: true, attributes: true });
    }

    return () => {
      try {
        if (select) select.removeEventListener("change", onChange);
      } catch {}
      try {
        mo?.disconnect();
      } catch {}
      api.log("anime-sama (streaming) module detached");
    };
  },
};
