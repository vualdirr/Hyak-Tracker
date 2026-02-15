// src/shared/autoMark.js
//    remainingThresholdSec: 30,
//    endPercent: 0.85,
//    minWatchSecondsFloor: 60,
//    minWatchPercent: 0.3,
//    maxCountableDeltaSec: 1.25,
//    ...config,

export function createAutoMarker({
  getEpisodeKey,
  onMarkWanted,
  getEnabled,
  config = {},
  log = () => {},
}) {
  const cfg = {
    remainingThresholdSec: 30,
    endPercent: 0.85,
    minWatchSecondsFloor: 60,
    minWatchPercent: 0.3,
    maxCountableDeltaSec: 1.25,
    ...config,
  };

  log("[autoMark] init", { config: cfg });

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
    log("[autoMark] reset episode", { episodeKey: key });
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
      log("[autoMark] conditions validées", {
        watchedSeconds: watched.toFixed(1),
        watchedPercent: (watchedPercent * 100).toFixed(1),
        remaining: remaining.toFixed(1),
        currentTime: currentTime.toFixed(1),
        duration: duration.toFixed(1),
      });
    }

    return okMin && okEnd;
  }

  function reportStatus(duration, currentTime) {
    const remaining = Math.max(0, duration - currentTime);
    const percent = duration > 0 ? currentTime / duration : 0;
    const watchedPercent = duration > 0 ? watched / duration : 0;

    const minWatchSeconds = Math.max(cfg.minWatchSecondsFloor, duration * 0.2);

    log("[autoMark] status", {
      duration: duration.toFixed(0),
      currentTime: currentTime.toFixed(1),
      percent: (percent * 100).toFixed(1),
      watched: watched.toFixed(1),
      watchedPercent: (watchedPercent * 100).toFixed(1),
      remaining: remaining.toFixed(1),
      okRemaining: remaining <= cfg.remainingThresholdSec,
      okEndPercent: percent >= cfg.endPercent,
      okMinSeconds: watched >= minWatchSeconds,
      okMinPercent: watchedPercent >= cfg.minWatchPercent,
    });
  }

  async function tick() {
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

      if (!video.paused && !seeking) {
        if (lastT != null) {
          const dt = t - lastT;

          if (dt > 0 && dt <= cfg.maxCountableDeltaSec) {
            watched += dt;

            if (watched - lastStatusReportAt >= 15) {
              lastStatusReportAt = watched;
              reportStatus(duration, t);
            }
          }
        }
      }

      lastT = t;

      if (shouldTrigger(duration, t)) {
        markedKey = key;

        log("[autoMark] déclenchement", {
          episodeKey: key,
          watchedSeconds: watched.toFixed(1),
          percent: ((t / duration) * 100).toFixed(1),
          remaining: (duration - t).toFixed(1),
        });

        await onMarkWanted({ key, watchedSeconds: watched, duration, t });
      }
    } catch (e) {
      log("[autoMark] tick error", {
        message: e?.message,
        stack: e?.stack,
      });
    }
  }

  function attach(v) {
    if (!v) return () => {};
    video = v;

    log("[autoMark] attach video", {
      duration: video?.duration ?? null,
    });

    const onSeeking = () => {
      seeking = true;
      log("[autoMark] seeking", {
        from: lastT?.toFixed(1),
        to: video.currentTime.toFixed(1),
      });
    };

    const onSeeked = () => {
      seeking = false;
      lastT = video.currentTime;
      log("[autoMark] seeked", {
        at: video.currentTime.toFixed(1),
      });
    };

    const onPlay = () => {
      lastT = video.currentTime;
      log("[autoMark] play", {
        at: video.currentTime.toFixed(1),
      });
    };

    const onPause = () => {
      log("[autoMark] pause", {
        at: video.currentTime.toFixed(1),
      });
    };

    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);

    const interval = setInterval(tick, 1000);

    return () => {
      clearInterval(interval);

      try {
        v.removeEventListener("seeking", onSeeking);
        v.removeEventListener("seeked", onSeeked);
        v.removeEventListener("play", onPlay);
        v.removeEventListener("pause", onPause);
      } catch {}

      log("[autoMark] detach video");

      video = null;
    };
  }

  return { attach, resetForEpisode };
}
