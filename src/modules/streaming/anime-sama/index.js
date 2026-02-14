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

    api.log("Initialisation debounce extract", { delay: 150 });

    const fire = debounce(async (meta) => {
      api.log("Extraction déclenchée", meta);

      let ctx;
      try {
        ctx = extractAnimeSamaContext();
      } catch (err) {
        api.log("Erreur extractAnimeSamaContext", {
          message: err?.message,
        });
        return;
      }

      api.log("Résultat extraction", {
        hasTitle: !!ctx?.title,
        episode: ctx?.episode ?? null,
      });

      try {
        await publish(ctx, meta);
        api.log("STREAM_UPDATE publié", meta);
      } catch (err) {
        api.log("Erreur publication STREAM_UPDATE", {
          message: err?.message,
        });
      }

      if (ctx?.title && ctx?.episode) {
        api.log("CTX OK", ctx);

        await chrome.runtime.sendMessage({
          type: "LOG_PUSH",
          level: "info",
          kind: "step",
          scope: "streaming/anime-sama",
          message: `Contexte détecté: ${ctx.title} E${ctx.episode}`,
        });
      } else {
        api.log("CTX incomplet", {
          title: ctx?.title ?? null,
          episode: ctx?.episode ?? null,
        });
      }
    }, 150);

    // 1) First extract
    api.log("Premier fire (startup)");
    fire({ kind: "init", reason: "startup" });

    // 2) Change episode via select
    const select = document.querySelector("#selectEpisodes");
    const onChange = () => fire({ kind: "change", reason: "selectEpisode" });

    if (select) {
      select.addEventListener("change", onChange, { passive: true });
      api.log("Listener change attaché sur #selectEpisodes");
    } else {
      api.log("Select #selectEpisodes non trouvé");
    }

    // 3) Mutation observer on select (SPA quirks)
    let mo = null;
    if (select) {
      mo = new MutationObserver(() =>
        fire({ kind: "mut", reason: "selectMutation" }),
      );
      mo.observe(select, { childList: true, subtree: true, attributes: true });
      api.log("MutationObserver attaché sur #selectEpisodes");
    }

    return () => {
      try {
        if (select) {
          select.removeEventListener("change", onChange);
          api.log("Listener change retiré");
        }
      } catch {}

      try {
        mo?.disconnect();
        api.log("MutationObserver déconnecté");
      } catch {}

      api.log("anime-sama (streaming) module detached");
    };
  },
};
