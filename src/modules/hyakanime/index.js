// src/modules/hyakanime/index.js

function findAuthToken(api) {
  const candidates = [];

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k);
    if (!v) continue;

    const looksJwt =
      typeof v === "string" && v.split(".").length === 3 && v.length > 40;
    const looksLong =
      typeof v === "string" && v.length > 80 && /[A-Za-z0-9\-_=.]+/.test(v);

    if (looksJwt || looksLong) candidates.push({ key: k, value: v });
  }

  api.log("localStorage scan terminé", {
    totalKeys: localStorage.length,
    candidates: candidates.length,
  });

  candidates.sort((a, b) => {
    const score = (x) =>
      (/(token|auth|jwt|access)/i.test(x.key) ? 10 : 0) +
      Math.min(5, Math.floor(x.value.length / 100));
    return score(b) - score(a);
  });

  const found = candidates[0]?.value || null;

  if (found) {
    api.log("Token candidat détecté (non exposé)", {
      key: candidates[0]?.key,
      length: found.length,
    });
  } else {
    api.log("Aucun token détecté dans localStorage");
  }

  return found;
}

async function pushTokenIfAny(api) {
  const token = findAuthToken(api);
  if (!token) return false;

  await chrome.runtime.sendMessage({ type: "HYAKANIME_TOKEN", token });
  api.log("Token envoyé au background");
  return true;
}

export default {
  id: "hyakanime",

  async run(api) {
    api.log("hyakanime module attached");

    // 1) try once
    api.log("Tentative initiale récupération token");
    pushTokenIfAny(api);

    // 2) retry a bit
    const t = setTimeout(() => {
      api.log("Retry récupération token (1.5s)");
      pushTokenIfAny(api);
    }, 1500);

    // 3) observer storage
    const onStorage = () => {
      api.log("Event storage détecté");
      pushTokenIfAny(api);
    };

    window.addEventListener("storage", onStorage);
    api.log("Listener storage attaché");

    return () => {
      clearTimeout(t);
      window.removeEventListener("storage", onStorage);
      api.log("hyakanime module detached");
    };
  },
};
