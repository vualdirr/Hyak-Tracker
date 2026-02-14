// E:\Hyak-Tracker\src\modules\playervideos\vidmoly\index.js
import { createAutoMarker } from "../../../shared/autoMark.js";
import { norm } from "../../../shared/player/norm.js";

function makeAnimeKey(title, season) {
  const s = Number.isFinite(season) && season > 0 ? season : 1;
  return `${norm(title)}|s${s}`;
}

export default {
  id: "playervideos/vidmoly",

  match(hostname) {
    return hostname === "vidmoly.biz" || hostname.endsWith(".vidmoly.biz");
  },

  async run(api) {
    api.log("vidmoly (player) module attached");

    function findVideo() {
      return document.querySelector("video");
    }

    async function getAutoEnabled() {
      // ⚠️ appelé très souvent par autoMark -> NE PAS logger ici (sinon spam)
      const s = await chrome.storage.local.get("autoMarkEnabled");
      return s.autoMarkEnabled ?? false;
    }

    // ---- cache ctx (car getEpisodeKey doit être sync) ----
    let cachedCtx = null;
    let ctxPollTimer = null;

    // Anti-spam: log uniquement quand le contexte change réellement
    let lastCtxSig = null;
    let hadCtx = false;

    function ctxSignature(ctx) {
      if (!ctx) return "null";
      const title = ctx?.title ?? "";
      const season = ctx?.season ?? 1;
      const episode = ctx?.episode ?? "";
      return `${norm(title)}|s${season}|e${episode}`;
    }

    async function refreshCtx() {
      try {
        const res = await chrome.runtime.sendMessage({
          type: "GET_STREAM_CONTEXT",
        });
        const nextCtx = res?.ctx || null;

        const nextSig = ctxSignature(nextCtx);
        if (nextSig !== lastCtxSig) {
          // log seulement sur changement
          api.log("STREAM_CONTEXT updated", {
            hasCtx: !!nextCtx,
            title: nextCtx?.title ?? null,
            season: nextCtx?.season ?? null,
            episode: nextCtx?.episode ?? null,
          });
          lastCtxSig = nextSig;
        }

        // log transitions (utile debug) : ctx présent -> absent / absent -> présent
        if (!!nextCtx !== hadCtx) {
          hadCtx = !!nextCtx;
          api.log("STREAM_CONTEXT presence changed", { hasCtx: hadCtx });
        }

        cachedCtx = nextCtx;
      } catch (e) {
        // log uniquement si on passe en erreur (ou si on n’avait pas déjà ctx null)
        if (lastCtxSig !== "error") {
          api.log("STREAM_CONTEXT refresh failed", {
            message: e?.message,
          });
          lastCtxSig = "error";
        }
        cachedCtx = null;
      }
    }

    await refreshCtx();
    ctxPollTimer = setInterval(refreshCtx, 1500);

    const autoMarker = createAutoMarker({
      getEpisodeKey: () => {
        // ⚠️ appelé très souvent -> NE PAS logger ici (sinon spam)
        if (cachedCtx?.title && cachedCtx?.episode) {
          const s = cachedCtx.season ?? 1;
          return `${norm(cachedCtx.title)}|s${s}|e${cachedCtx.episode}`;
        }
        // fallback (moins fiable)
        return "vidmoly:" + (document.referrer || location.href);
      },

      getEnabled: async () => await getAutoEnabled(),

      onMarkWanted: async () => {
        const ctx = cachedCtx;

        if (!ctx?.title || !ctx?.episode) {
          chrome.runtime.sendMessage({
            type: "LOG_PUSH",
            level: "error",
            kind: "step",
            scope: "automark/player",
            message: "❌ Automark: contexte streaming manquant",
          });
          return;
        }

        const ep = Number.parseInt(ctx.episode, 10);
        if (!Number.isFinite(ep) || ep <= 0) {
          chrome.runtime.sendMessage({
            type: "LOG_PUSH",
            level: "error",
            kind: "step",
            scope: "automark/player",
            message: `❌ Automark: épisode invalide (${ctx.episode})`,
          });
          return;
        }

        api.log("Automark commit demandé", {
          title: ctx.title,
          season: ctx.season ?? 1,
          episode: ep,
          animeKey: makeAnimeKey(ctx.title, ctx.season ?? 1),
        });

        chrome.runtime.sendMessage({
          type: "LOG_PUSH",
          level: "info",
          kind: "step",
          scope: "automark/player",
          message: `🚀 Automark déclenché (E${ep})`,
        });

        await chrome.runtime.sendMessage({
          type: "AUTOMARK_COMMIT",
          ctx,
          episode: ep,
        });
      },

      log: (...a) => api.log("[autoMark]", ...a),
    });

    let video = null;
    let detachAuto = null;
    let detach = null;

    // Anti-spam: log "no video yet" une seule fois
    let warnedNoVideoYet = false;

    const attach = (v) => {
      if (!v || video) return;
      video = v;

      api.log("Vidéo trouvée, attach autoMarker");

      chrome.runtime.sendMessage({
        type: "LOG_PUSH",
        level: "info",
        kind: "step",
        scope: "playervideos/vidmoly",
        message: "Player vidéo détecté (vidmoly)",
      });

      detachAuto = autoMarker.attach(v);

      return () => {
        try {
          detachAuto?.();
        } catch {}
        detachAuto = null;
        video = null;
        api.log("Detach autoMarker vidéo");
      };
    };

    const tryAttach = () => {
      if (detach) return;
      const v = findVideo();
      if (!v) {
        if (!warnedNoVideoYet) {
          warnedNoVideoYet = true;
          api.log("Aucune vidéo détectée pour l'instant");
        }
        return;
      }
      detach = attach(v);
    };

    tryAttach();

    const mo = new MutationObserver(tryAttach);
    mo.observe(document.documentElement, { childList: true, subtree: true });

    api.log("MutationObserver attaché (player)");

    return () => {
      try {
        mo.disconnect();
      } catch {}
      try {
        detach?.();
      } catch {}
      try {
        if (ctxPollTimer) clearInterval(ctxPollTimer);
      } catch {}
      api.log("vidmoly (player) module detached");
    };
  },
};
