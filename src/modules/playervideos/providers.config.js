// src/modules/playervideos/providers.config.js

export const PLAYER_PROVIDERS = [
  {
    id: "vidmoly",
    scope: "playervideos/vidmoly",
    hosts: ["vidmoly.biz"],
    videoSelectors: ["video"],
    waitMetadataMs: 0,
  },
  {
    id: "smoothpre",
    scope: "playervideos/smoothpre",
    hosts: ["smoothpre.com"],
    videoSelectors: ["video"],
    waitMetadataMs: 4000,
  },
  {
    id: "embed4me",
    scope: "playervideos/embed4me",
    hosts: ["lpayer.embed4me.com", "embed4me.com"],
    videoSelectors: ["video"],
    waitMetadataMs: 4000,
  },
  {
    id: "sibnet",
    scope: "playervideos/sibnet",
    hosts: ["video.sibnet.ru", "sibnet.ru"],
    videoSelectors: ["video.vjs-tech"],
    waitMetadataMs: 8000,
  },
  {
    id: "sendvid",
    scope: "playervideos/sendvid",
    hosts: ["sendvid.com"],
    videoSelectors: [
      "video.vjs-tech#video-js-video_html5_api",
      "video.vjs-tech",
      "video",
    ],
    waitMetadataMs: 8000,
  },
];

export function findProviderByHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return null;

  for (const p of PLAYER_PROVIDERS) {
    for (const host of p.hosts) {
      const base = String(host).toLowerCase();
      if (h === base) return p;
      if (
        base.startsWith("video.") &&
        h.endsWith(base.replace(/^video\./, "."))
      )
        return p; // tolérance
      if (!base.includes("lpayer.") && h.endsWith("." + base)) return p;
      if (h.endsWith("." + base)) return p;
    }
  }

  return null;
}
