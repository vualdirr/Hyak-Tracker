// src/core/registry.js
export function findModule(hostname, url) {
  // --- Hyakanime (site app / bibliothèque) ---
  if (hostname === "www.hyakanime.fr" || hostname === "hyakanime.fr") {
    return {
      id: "hyakanime",
      run: async (api) => {
        const mod = await import(
          chrome.runtime.getURL("src/modules/hyakanime/index.js")
        );
        return mod.default.run(api);
      },
    };
  }

  // --- Streaming sites ---
  if (hostname === "anime-sama.tv" || hostname.endsWith(".anime-sama.tv")) {
    return {
      id: "streaming/anime-sama",
      run: async (api) => {
        const mod = await import(
          chrome.runtime.getURL("src/modules/streaming/anime-sama/index.js")
        );
        return mod.default.run(api);
      },
    };
  }

  if (hostname === "voiranime.com" || hostname.endsWith(".voiranime.com")) {
    return {
      id: "streaming/voiranime",
      run: async (api) => {
        const mod = await import(
          chrome.runtime.getURL("src/modules/streaming/voiranime/index.js")
        );
        return mod.default.run(api);
      },
    };
  }

  // --- Player videos domains ---
  if (hostname === "vidmoly.biz" || hostname.endsWith(".vidmoly.biz")) {
    return {
      id: "playervideos/vidmoly",
      run: async (api) => {
        const mod = await import(
          chrome.runtime.getURL("src/modules/playervideos/vidmoly/index.js")
        );
        return mod.default.run(api);
      },
    };
  }

  return null;
}
