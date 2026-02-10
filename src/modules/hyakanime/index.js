// src/modules/hyakanime/index.js

function findAuthToken() {
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

  candidates.sort((a, b) => {
    const score = (x) =>
      (/(token|auth|jwt|access)/i.test(x.key) ? 10 : 0) +
      Math.min(5, Math.floor(x.value.length / 100));
    return score(b) - score(a);
  });

  return candidates[0]?.value || null;
}

async function pushTokenIfAny(api) {
  const token = findAuthToken();
  if (!token) return false;

  await chrome.runtime.sendMessage({ type: "HYAKANIME_TOKEN", token });
  api.log("token sent to background");
  return true;
}

export default {
  id: "hyakanime",

  async run(api) {
    api.log("hyakanime module attached");

    // 1) try once
    pushTokenIfAny(api);

    // 2) retry a bit (au cas où le site hydrate le storage après)
    const t = setTimeout(() => pushTokenIfAny(api), 1500);

    // 3) et observer les changements de localStorage via l’event storage
    // (note: surtout utile si token est modifié/renouvelé)
    const onStorage = () => pushTokenIfAny(api);
    window.addEventListener("storage", onStorage);

    return () => {
      clearTimeout(t);
      window.removeEventListener("storage", onStorage);
      api.log("hyakanime module detached");
    };
  },
};
