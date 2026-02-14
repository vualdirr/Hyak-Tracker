// E:\Hyak-Tracker\content.js
(async () => {
  const hostname = location.hostname;

  const { findModule } = await import(
    chrome.runtime.getURL("src/core/registry.js")
  );

  const { createLogger } = await import(
    chrome.runtime.getURL("src/core/logger.js")
  );

  const mod = findModule(hostname, location.href);
  if (!mod) return;

  const logger = createLogger({
    scope: `content:${mod.id}`,
    originHost: hostname,
    originUrl: location.href,
  });

  logger.step(`Module détecté: ${mod.id}`);

  const detach = await mod.run({
    log: (...a) => logger.debug("module log", { args: a }),
  });

  logger.step(`Module initialisé: ${mod.id}`);

  window.addEventListener(
    "beforeunload",
    () => {
      try {
        detach?.();
      } catch {}
    },
    { once: true },
  );
})();
