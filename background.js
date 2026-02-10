const API_BASE = "https://api-v5.hyakanime.fr";

let cachedToken = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "HYAKANIME_TOKEN") {
      cachedToken = msg.token;
      await chrome.storage.local.set({ hyakanimeToken: cachedToken });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "GET_TOKEN") {
      if (!cachedToken) {
        const s = await chrome.storage.local.get(["hyakanimeToken"]);
        cachedToken = s.hyakanimeToken || null;
      }
      sendResponse({ token: cachedToken });
      return;
    }

    if (msg?.type === "SEARCH_ANIME") {
      const token = await getToken();
      const q = encodeURIComponent(msg.query || "");
      const res = await fetch(`${API_BASE}/search/anime/${q}`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await safeJson(res);
      sendResponse({ ok: res.ok, status: res.status, data });
      return;
    }

    if (msg?.type === "WRITE_PROGRESSION") {
      const token = await getToken();
      if (!token) {
        sendResponse({ ok: false, error: "NO_TOKEN" });
        return;
      }

      const body = {
        id: msg.id,
        progression: msg.progression,
        status: msg.status ?? 1,
      };

      // Champs optionnels — uniquement si présents
      if (msg.animeID != null) body.animeID = msg.animeID;
      if (msg.lastChange != null) body.lastChange = msg.lastChange;
      if (msg.startDate != null) body.startDate = msg.startDate;
      if (msg.endDate != null) body.endDate = msg.endDate;

      const res = await fetch(`${API_BASE}/progression/anime/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await safeJson(res);
      sendResponse({ ok: res.ok, status: res.status, data });
      return;
    }

    sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
  })();

  // indique qu'on répond async
  return true;
});

async function getToken() {
  if (cachedToken) return cachedToken;
  const s = await chrome.storage.local.get(["hyakanimeToken"]);
  cachedToken = s.hyakanimeToken || null;
  return cachedToken;
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return await res.text();
  }
}
