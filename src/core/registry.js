// src/core/registry.js
export function findModule(hostname, url) {
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
  if (hostname === "anime-sama.tv" || hostname.endsWith(".anime-sama.tv")) {
    return {
      id: "anime-sama",
      run: async (api) => {
        const mod = await import(
          chrome.runtime.getURL("src/modules/anime-sama/index.js")
        );
        return mod.default.run(api);
      },
    };
  }
  if (hostname === "voiranime.com" || hostname.endsWith(".voiranime.com")) {
    return {
      id: "voiranime",
      run: async (api) => {
        const mod = await import(
          chrome.runtime.getURL("src/modules/voiranime/index.js")
        );
        return mod.default.run(api);
      },
    };
  }

  return null;
}
