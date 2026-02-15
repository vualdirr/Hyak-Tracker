// E:\Hyak-Tracker\src\core\registry.js

import { createLogger } from "./logger.js";

export function findModule(hostname, url) {
  const logger = createLogger({
    scope: "registry",
    originHost: hostname,
    originUrl: url,
  });

  logger.debug("findModule appelé", { hostname });

  // --- Hyakanime (site app / bibliothèque) ---
  if (hostname === "www.hyakanime.fr" || hostname === "hyakanime.fr") {
    logger.info("Module matché", { id: "hyakanime" });

    return {
      id: "hyakanime",
      run: async (api) => {
        try {
          const mod = await import(
            chrome.runtime.getURL("src/modules/hyakanime/index.js")
          );
          return mod.default.run(api);
        } catch (err) {
          logger.error("Erreur import module hyakanime", {
            message: err?.message,
          });
          throw err;
        }
      },
    };
  }

  // --- Streaming sites ---
  if (hostname === "anime-sama.tv" || hostname.endsWith(".anime-sama.tv")) {
    logger.info("Module matché", { id: "streaming/anime-sama" });

    return {
      id: "streaming/anime-sama",
      run: async (api) => {
        try {
          const mod = await import(
            chrome.runtime.getURL("src/modules/streaming/anime-sama/index.js")
          );
          return mod.default.run(api);
        } catch (err) {
          logger.error("Erreur import module anime-sama", {
            message: err?.message,
          });
          throw err;
        }
      },
    };
  }

  if (hostname === "voiranime.com" || hostname.endsWith(".voiranime.com")) {
    logger.info("Module matché", { id: "streaming/voiranime" });

    return {
      id: "streaming/voiranime",
      run: async (api) => {
        try {
          const mod = await import(
            chrome.runtime.getURL("src/modules/streaming/voiranime/index.js")
          );
          return mod.default.run(api);
        } catch (err) {
          logger.error("Erreur import module voiranime", {
            message: err?.message,
          });
          throw err;
        }
      },
    };
  }

  // --- Player videos domains ---
  if (hostname === "vidmoly.biz" || hostname.endsWith(".vidmoly.biz")) {
    logger.info("Module matché", { id: "playervideos/vidmoly" });

    return {
      id: "playervideos/vidmoly",
      run: async (api) => {
        try {
          const mod = await import(
            chrome.runtime.getURL("src/modules/playervideos/vidmoly/index.js")
          );
          return mod.default.run(api);
        } catch (err) {
          logger.error("Erreur import module vidmoly", {
            message: err?.message,
          });
          throw err;
        }
      },
    };
  }

  if (hostname === "smoothpre.com" || hostname.endsWith(".smoothpre.com")) {
    logger.info("Module matché", { id: "playervideos/smoothpre" });

    return {
      id: "playervideos/smoothpre",
      run: async (api) => {
        try {
          const mod = await import(
            chrome.runtime.getURL("src/modules/playervideos/smoothpre/index.js")
          );
          return mod.default.run(api);
        } catch (err) {
          logger.error("Erreur import module smoothpre", {
            message: err?.message,
          });
          throw err;
        }
      },
    };
  }

  logger.debug("Aucun module trouvé pour hostname", { hostname });

  return null;
}
