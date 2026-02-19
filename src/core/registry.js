// src/core/registry.js

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

  // --- Player videos domains (generic) ---
  // On délègue le match au module générique (qui s'appuie sur providers.config).
  // Ça évite d'avoir 1 bloc if par provider.
  {
    logger.info("Module matché", { id: "playervideos/generic" });

    return {
      id: "playervideos/generic",
      run: async (api) => {
        try {
          const mod = await import(
            chrome.runtime.getURL("src/modules/playervideos/index.js")
          );
          return mod.default.run(api);
        } catch (err) {
          logger.error("Erreur import module playervideos/generic", {
            message: err?.message,
          });
          throw err;
        }
      },
    };
  }

  // (Note) si tu veux absolument éviter de charger le generic sur tous les hosts,
  // il faudrait ajouter un garde-fou ici avec une liste de hosts.
  // Mais avec ton manifest actuel, le content script ne tourne déjà que sur les hosts autorisés. :contentReference[oaicite:7]{index=7}
}
