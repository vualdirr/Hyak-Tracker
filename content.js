// content.js
(async () => {
  const hostname = location.hostname;

  // charge le registry en ESM via import()
  const { findModule } = await import(
    chrome.runtime.getURL("src/core/registry.js")
  );

  const mod = findModule(hostname, location.href);
  if (!mod) return; // ✅ aucun module -> aucune action

  console.log("[HyakTracker] module matched:", mod.id);
  const detach = await mod.run({
    log: (...a) => console.log(`[Hyak:${mod.id}]`, ...a),
  });

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
