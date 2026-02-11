// src/modules/playervideos/vidmoly/index.js
import { createAutoMarker } from "../../../shared/autoMark.js";

// ⚠️ doit matcher la clé utilisée pour animeLinkMap
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\[\(].*?[\]\)]/g, " ")
    .replace(/(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
      const s = await chrome.storage.local.get("autoMarkEnabled");
      return s.autoMarkEnabled ?? false;
    }

    // ---- cache ctx (car getEpisodeKey doit être sync) ----
    let cachedCtx = null;
    let ctxPollTimer = null;

    async function refreshCtx() {
      try {
        const res = await chrome.runtime.sendMessage({
          type: "GET_STREAM_CONTEXT",
        });
        cachedCtx = res?.ctx || null;
      } catch {
        cachedCtx = null;
      }
    }

    await refreshCtx();
    ctxPollTimer = setInterval(refreshCtx, 1500);

    const autoMarker = createAutoMarker({
      getEpisodeKey: () => {
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
          api.log("❌ Aucun contexte streaming actif.");
          return;
        }

        const ep = Number.parseInt(ctx.episode, 10);
        if (!Number.isFinite(ep) || ep <= 0) {
          api.log("❌ Episode invalide:", ctx.episode);
          return;
        }

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

    const attach = (v) => {
      if (!v || video) return;
      video = v;

      api.log("🎥 video detected", {
        paused: v.paused,
        duration: v.duration,
        currentTime: v.currentTime,
      });

      detachAuto = autoMarker.attach(v);

      return () => {
        try {
          detachAuto?.();
        } catch {}
        detachAuto = null;
        video = null;
      };
    };

    const tryAttach = () => {
      if (detach) return;
      const v = findVideo();
      if (!v) return;
      detach = attach(v);
    };

    tryAttach();

    const mo = new MutationObserver(tryAttach);
    mo.observe(document.documentElement, { childList: true, subtree: true });

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
