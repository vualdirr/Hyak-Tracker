// src/shared/autoMark.js

/**
 * Auto-mark basé sur "watch time réel" (anti-seek) + fin proche.
 * - Ne compte pas le temps si l'utilisateur saute (delta trop grand)
 * - Déclenche une seule fois par "episodeKey"
 */
/** Prod cfg
 
    remainingThresholdSec: 30, // <= 30s restantes
    endPercent: 0.85, // >= 95% de la durée
    minWatchSecondsFloor: 60, // au moins 60s
    minWatchPercent: 0.3, // ou 30% regardé
    maxCountableDeltaSec: 1.25, // anti-seek: on compte max 1.25s par tick 
    */

/** debug cfg
 
    remainingThresholdSec: 30, // <= 30s restantes
    endPercent: 0.05, // >= 95% de la durée
    minWatchSecondsFloor: 60, // au moins 60s
    minWatchPercent: 0.01, // ou 30% regardé
    maxCountableDeltaSec: 1.25, // anti-seek: on compte max 1.25s par tick 
 */

export function createAutoMarker({
  getEpisodeKey,
  onMarkWanted,
  getEnabled,
  config = {},
  log = () => {},
}) {
  const cfg = {
    remainingThresholdSec: 30, // <= 30s restantes
    endPercent: 0.85, // >= 95% de la durée
    minWatchSecondsFloor: 60, // au moins 60s
    minWatchPercent: 0.3, // ou 30% regardé
    maxCountableDeltaSec: 1.25, // anti-seek: on compte max 1.25s par tick
    ...config,
  };

  /** @type {HTMLVideoElement|null} */
  let video = null;

  let lastT = null;
  let watched = 0;
  let seeking = false;
  let markedKey = null;
  let lastStatusReportAt = 0;

  function resetForEpisode(key) {
    markedKey = null;
    lastT = null;
    watched = 0;
    seeking = false;
    log("[autoMark] reset episodeKey=", key);
  }

  function shouldTrigger(duration, currentTime) {
    if (!Number.isFinite(duration) || duration <= 0) return false;

    const remaining = Math.max(0, duration - currentTime);
    const watchedPercent = watched / duration;

    const minWatchSeconds = Math.max(cfg.minWatchSecondsFloor, duration * 0.2);
    const okMin =
      watched >= minWatchSeconds || watchedPercent >= cfg.minWatchPercent;

    const okEnd =
      remaining <= cfg.remainingThresholdSec ||
      currentTime / duration >= cfg.endPercent;

    if (okMin && okEnd) {
      log("[autoMark] ✅ CONDITIONS VALIDÉES", {
        watchedSeconds: watched.toFixed(1),
        watchedPercent: (watchedPercent * 100).toFixed(1) + "%",
        remaining: remaining.toFixed(1) + "s",
        currentTime: currentTime.toFixed(1) + "s",
        duration: duration.toFixed(1) + "s",
      });
    }

    return okMin && okEnd;
  }

  function reportStatus(duration, currentTime) {
    const remaining = Math.max(0, duration - currentTime);
    const percent = duration > 0 ? currentTime / duration : 0;
    const watchedPercent = duration > 0 ? watched / duration : 0;

    const minWatchSeconds = Math.max(cfg.minWatchSecondsFloor, duration * 0.2);

    const okRemaining = remaining <= cfg.remainingThresholdSec;
    const okEndPercent = percent >= cfg.endPercent;
    const okMinSeconds = watched >= minWatchSeconds;
    const okMinPercent = watchedPercent >= cfg.minWatchPercent;

    log("──────────── 📊 AUTO-MARK STATUS ────────────");
    log(`Durée épisode: ${duration.toFixed(0)}s`);
    log(
      `Position actuelle: ${currentTime.toFixed(1)}s (${(percent * 100).toFixed(
        1,
      )}%)`,
    );
    log(
      `Temps réellement regardé: ${watched.toFixed(1)}s (${(
        watchedPercent * 100
      ).toFixed(1)}%)`,
    );

    log(
      `remainingThresholdSec → restant ${remaining.toFixed(
        1,
      )}s / seuil ${cfg.remainingThresholdSec}s → ${okRemaining ? "✅" : "❌"}`,
    );

    log(
      `endPercent → ${(percent * 100).toFixed(
        1,
      )}% / requis ${(cfg.endPercent * 100).toFixed(0)}% → ${
        okEndPercent ? "✅" : "❌"
      }`,
    );

    log(
      `minWatchSecondsFloor → ${watched.toFixed(
        1,
      )}s / requis ${minWatchSeconds.toFixed(1)}s → ${
        okMinSeconds ? "✅" : "❌"
      }`,
    );

    log(
      `minWatchPercent → ${(watchedPercent * 100).toFixed(
        1,
      )}% / requis ${(cfg.minWatchPercent * 100).toFixed(0)}% → ${
        okMinPercent ? "✅" : "❌"
      }`,
    );

    log("─────────────────────────────────────────────");
  }

  async function tick() {
    // log("[autoMark] tick", { paused: video?.paused, t: video?.currentTime });
    try {
      if (!video) return;

      const enabled = await getEnabled();
      if (!enabled) return;

      const key = getEpisodeKey();
      if (!key) return;

      if (markedKey === key) return;

      const duration = video.duration;
      const t = video.currentTime;

      if (!Number.isFinite(duration) || duration <= 0) return;

      // 1) Incrément du "watch time réel"
      if (!video.paused && !seeking) {
        if (lastT != null) {
          const dt = t - lastT;

          // anti-seek: si dt trop grand (jump), on ne compte pas
          if (dt > 0 && dt <= cfg.maxCountableDeltaSec) {
            watched += dt;

            // 2) Report toutes les 15 secondes RÉELLES regardées
            if (watched - lastStatusReportAt >= 15) {
              lastStatusReportAt = watched;
              reportStatus(duration, t);
            }
          }
        }
      }

      lastT = t;

      // 3) Déclenchement
      if (shouldTrigger(duration, t)) {
        markedKey = key;
        log("[autoMark] 🚀 MARQUAGE AUTO DÉCLENCHÉ", {
          episodeKey: key,
          watchedSeconds: watched.toFixed(1),
          percent: ((t / duration) * 100).toFixed(1) + "%",
          remaining: (duration - t).toFixed(1) + "s",
        });

        await onMarkWanted({ key, watchedSeconds: watched, duration, t });
      }
    } catch (e) {
      log("[autoMark] tick error:", e?.message || e);
    }
  }

  function attach(v) {
    if (!v) return () => {};
    video = v;

    const onSeeking = () => {
      seeking = true;
      log(
        "[autoMark] ⏩ seeking",
        `from=${lastT?.toFixed(1)}s to=${video.currentTime.toFixed(1)}s`,
      );
    };

    const onSeeked = () => {
      seeking = false;
      lastT = video.currentTime;
      log("[autoMark] ⏩ seeked at", `${video.currentTime.toFixed(1)}s`);
    };

    const onPlay = () => {
      lastT = video.currentTime;
      log("[autoMark] ▶️ play at", `${video.currentTime.toFixed(1)}s`);
    };

    const onPause = () => {
      log("[autoMark] ⏸ pause at", `${video.currentTime.toFixed(1)}s`);
    };

    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("play", onPlay);

    v.addEventListener("pause", onPause);
    try {
      v.removeEventListener("pause", onPause);
    } catch {}

    const interval = setInterval(tick, 1000);

    return () => {
      clearInterval(interval);
      try {
        v.removeEventListener("seeking", onSeeking);
        v.removeEventListener("seeked", onSeeked);
        v.removeEventListener("play", onPlay);
      } catch {}
      video = null;
    };
  }

  return { attach, resetForEpisode };
}
