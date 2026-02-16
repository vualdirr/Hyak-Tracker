// E:\Hyak-Tracker\content.js
(async () => {
  const hostname = location.hostname;
  const href = location.href;
  const isTopFrame = window.top === window;

  let logger;

  try {
    const { findModule } = await import(
      chrome.runtime.getURL("src/core/registry.js")
    );

    const { createLogger } = await import(
      chrome.runtime.getURL("src/core/logger.js")
    );

    logger = createLogger({
      scope: `content`,
      originHost: hostname,
      originUrl: href,
    });

    logger.info("Content script démarré", {
      hostname,
      isTopFrame,
    });

    logger.debug("Imports dynamiques chargés");

    const mod = findModule(hostname, href);

    if (!mod) {
      logger.debug("Aucun module correspondant trouvé", {
        hostname,
      });
      return;
    }

    // Logger scoppé module
    logger = createLogger({
      scope: `content:${mod.id}`,
      originHost: hostname,
      originUrl: href,
    });

    logger.step(`Module correspondant trouvé: ${mod.id}`);
    logger.info("Module sélectionné", {
      moduleId: mod.id,
    });

    let detach;

    try {
      logger.debug("Initialisation module.run()");
      detach = await mod.run({
        log: (...a) => {
          if (a.length === 1) {
            logger.debug("module log", a[0]);
          } else {
            logger.debug("module log", a);
          }
        },
      });

      logger.step(`Module initialisé: ${mod.id}`);
      logger.info("Module run terminé avec succès");
    } catch (err) {
      logger.error("Erreur lors de l'initialisation du module", {
        message: err?.message,
        stack: err?.stack,
      });
      return;
    }

    window.addEventListener(
      "beforeunload",
      () => {
        try {
          logger.debug("beforeunload détecté, detach module");
          detach?.();
        } catch (err) {
          logger.error("Erreur lors du detach module", {
            message: err?.message,
          });
        }
      },
      { once: true },
    );
  } catch (err) {
    if (logger) {
      logger.error("Erreur critique content script", {
        message: err?.message,
        stack: err?.stack,
      });
    } else {
      // dernier recours si logger pas dispo
      console.error("Content script crash avant init logger", err);
    }
  }
})();
