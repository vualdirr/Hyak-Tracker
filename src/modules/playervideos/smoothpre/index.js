// src/modules/playervideos/smoothpre/index.js
import { createAutoMarker } from "../../../shared/autoMark.js";
import { norm } from "../../../shared/player/norm.js";

function makeAnimeKey(title, season) {
  const s = Number.isFinite(season) && season > 0 ? season : 1;
  return `${norm(title)}|s${s}`;
}

function isDurationReady(v) {
  return Number.isFinite(v?.duration) && v.duration > 0;
}

async function waitLoadedMetadata(v, timeoutMs = 4000) {
  if (!v) return false;
  if (isDurationReady(v)) return true;

  return await new Promise((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve(isDurationReady(v));
    };

    const onReady = () => finish();
    const onTimeout = () => finish();

    const cleanup = () => {
      try {
        v.removeEventListener("loadedmetadata", onReady);
        v.removeEventListener("durationchange", onReady);
      } catch {}
      try {
        clearTimeout(tid);
      } catch {}
    };

    try {
      v.addEventListener("loadedmetadata", onReady, { once: true });
      v.addEventListener("durationchange", onReady, { once: true });
    } catch {
      // si addEventListener échoue, on fera juste le timeout
    }

    const tid = setTimeout(onTimeout, timeoutMs);
  });
}

export default {
  id: "playervideos/smoothpre",

  match(hostname) {
    return hostname === "smoothpre.com" || hostname.endsWith(".smoothpre.com");
  },

  async run(api) {
    api.log("smoothpre (player) module attached");

    function findVideo() {
      return document.querySelector("video");
    }

    async function getAutoEnabled() {
      // ⚠️ appelé très souvent par autoMark -> NE PAS logger ici
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
          api.log("STREAM_CONTEXT updated", {
            hasCtx: !!nextCtx,
            title: nextCtx?.title ?? null,
            season: nextCtx?.season ?? null,
            episode: nextCtx?.episode ?? null,
          });
          lastCtxSig = nextSig;
        }

        if (!!nextCtx !== hadCtx) {
          hadCtx = !!nextCtx;
          api.log("STREAM_CONTEXT presence changed", { hasCtx: hadCtx });
        }

        cachedCtx = nextCtx;
      } catch (e) {
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
        // ⚠️ appelé très souvent -> NE PAS logger ici
        if (cachedCtx?.title && cachedCtx?.episode) {
          const s = cachedCtx.season ?? 1;
          return `${norm(cachedCtx.title)}|s${s}|e${cachedCtx.episode}`;
        }
        return "smoothpre:" + (document.referrer || location.href);
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

    let warnedNoVideoYet = false;

    const attach = async (v) => {
      if (!v || video) return;
      video = v;

      // ✅ Patch: attendre au mieux que la durée soit dispo (sinon duration:null au attach)
      const hadDurationBefore = isDurationReady(v);
      const ready = await waitLoadedMetadata(v, 4000);

      api.log("Vidéo trouvée, attach autoMarker", {
        duration: isDurationReady(v) ? v.duration : null,
        durationReady: ready,
        durationWasReady: hadDurationBefore,
        readyState: v.readyState ?? null,
      });

      chrome.runtime.sendMessage({
        type: "LOG_PUSH",
        level: "info",
        kind: "step",
        scope: "playervideos/smoothpre",
        message: "Player vidéo détecté (smoothpre)",
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

    const tryAttach = async () => {
      if (detach) return;
      const v = findVideo();

      if (!v) {
        if (!warnedNoVideoYet) {
          warnedNoVideoYet = true;
          api.log("Aucune vidéo détectée pour l'instant");
        }
        return;
      }

      detach = await attach(v);
    };

    // tentative immédiate
    await tryAttach();

    // observe DOM (player injecté tard / remplacé)
    const mo = new MutationObserver(() => {
      // éviter que MutationObserver déclenche un await non géré
      tryAttach();
    });
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
      api.log("smoothpre (player) module detached");
    };
  },
};
