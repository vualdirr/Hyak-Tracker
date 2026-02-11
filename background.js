const API_BASE = "https://api-v5.hyakanime.fr";

let cachedToken = null;

// ---- STREAM CONTEXT CACHE (RAM only, scoped per tab) ----
const streamSessions = new Map(); // tabId -> { ctx, ts }

async function cleanupAnimeLinkMap() {
  const { animeLinkMap = {} } = await chrome.storage.local.get("animeLinkMap");

  const now = Date.now();
  const TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours

  let changed = false;

  for (const [k, v] of Object.entries(animeLinkMap)) {
    if (!v?.ts || now - v.ts > TTL) {
      delete animeLinkMap[k];
      changed = true;
    }
  }

  // cap à 200 entrées
  const entries = Object.entries(animeLinkMap).sort(
    (a, b) => (b[1]?.ts ?? 0) - (a[1]?.ts ?? 0),
  );

  if (entries.length > 200) {
    for (const [k] of entries.slice(200)) {
      delete animeLinkMap[k];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ animeLinkMap });
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  streamSessions.delete(tabId);
});

chrome.runtime.onStartup.addListener(() => {
  cleanupAnimeLinkMap().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  cleanupAnimeLinkMap().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    // ----- STREAM CONTEXT -----
    if (msg?.type === "STREAM_UPDATE") {
      const tabId = sender?.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "NO_TAB" });
        return;
      }

      streamSessions.set(tabId, { ctx: msg.payload, ts: Date.now() });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "GET_STREAM_CONTEXT") {
      const tabId = sender?.tab?.id ?? msg?.tabId; // ✅ support popup
      if (!tabId) {
        sendResponse({ ok: false, error: "NO_TAB" });
        return;
      }

      const session = streamSessions.get(tabId) || null;
      sendResponse({ ok: true, ctx: session?.ctx || null });
      return;
    }

    // ----- TOKEN -----
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

    // ----- SEARCH -----
    if (msg?.type === "SEARCH_ANIME") {
      const token = await getToken();
      const q = encodeURIComponent(msg.query || "");
      const res = await fetch(`${API_BASE}/search/anime/${q}`, {
        method: "GET",
        headers: token ? { Authorization: token } : {},
      });
      const data = await safeJson(res);
      sendResponse({ ok: res.ok, status: res.status, data });
      return;
    }

    // ----- WRITE PROGRESSION -----
    // ----- WRITE PROGRESSION -----
    if (msg?.type === "WRITE_PROGRESSION") {
      const token = await getToken();
      if (!token) {
        sendResponse({ ok: false, error: "NO_TOKEN" });
        return;
      }

      // -----------------------------
      // ✅ ANTI DOWNGRADE (global)
      // -----------------------------
      const wanted = Number.parseInt(msg.progression, 10);
      const animeId = Number.parseInt(msg.animeID ?? msg.id, 10);

      // uid: si pas fourni par le caller, on le lit du storage (comme AUTOMARK_COMMIT)
      let uid = msg.uid;
      if (!uid) {
        const s = await chrome.storage.local.get(["hyakanimeUid"]);
        uid = s.hyakanimeUid || null;
      }

      if (
        uid &&
        Number.isFinite(animeId) &&
        Number.isFinite(wanted) &&
        wanted > 0
      ) {
        const progRes = await fetch(
          `${API_BASE}/progression/anime/${uid}/${animeId}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: token,
            },
          },
        );

        const progData = await safeJson(progRes);
        const known =
          progData?.progression?.progression ??
          progData?.data?.progression?.progression ??
          null;

        // 🔒 si déjà vu (>=), on ne write pas
        if (Number.isFinite(known) && known >= wanted) {
          sendResponse({
            ok: true,
            skipped: "ALREADY_UP_TO_DATE",
            known,
            wanted,
            animeId,
          });
          return;
        }
      }

      // -----------------------------
      // ✅ WRITE
      // -----------------------------
      const body = {
        id: msg.id,
        progression: msg.progression,
        status: msg.status ?? 1,
      };

      if (msg.animeID != null) body.animeID = msg.animeID;
      if (msg.lastChange != null) body.lastChange = msg.lastChange;
      if (msg.startDate != null) body.startDate = msg.startDate;
      if (msg.endDate != null) body.endDate = msg.endDate;

      const res = await fetch(`${API_BASE}/progression/anime/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
        body: JSON.stringify(body),
      });

      const data = await safeJson(res);
      sendResponse({ ok: res.ok, status: res.status, data });
      return;
    }

    // ----- GET PROGRESSION -----
    if (msg?.type === "GET_PROGRESSION_ANIME") {
      const token = await getToken();
      if (!token) {
        sendResponse({ ok: false, error: "NO_TOKEN" });
        return;
      }

      const uid = msg.uid;
      const animeId = msg.animeId;
      if (!uid || !animeId) {
        sendResponse({ ok: false, error: "BAD_ARGS" });
        return;
      }

      const res = await fetch(
        `${API_BASE}/progression/anime/${uid}/${animeId}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: token,
          },
        },
      );

      const data = await safeJson(res);
      sendResponse({ ok: res.ok, status: res.status, data });
      return;
    }

    // ----- GLOBAL AUTOMARK COMMIT -----
    if (msg?.type === "AUTOMARK_COMMIT") {
      const tabId = sender?.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "NO_TAB" });
        return;
      }

      const ctx = msg.ctx || streamSessions.get(tabId)?.ctx;
      if (!ctx?.title || !msg.episode) {
        sendResponse({ ok: false, error: "NO_CTX" });
        return;
      }

      const ep = Number.parseInt(msg.episode, 10);
      if (!Number.isFinite(ep) || ep <= 0) {
        sendResponse({ ok: false, error: "BAD_EPISODE" });
        return;
      }

      const token = await getToken();
      if (!token) {
        sendResponse({ ok: false, error: "NO_TOKEN" });
        return;
      }

      const { hyakanimeUid, animeLinkMap = {} } =
        await chrome.storage.local.get(["hyakanimeUid", "animeLinkMap"]);

      if (!hyakanimeUid) {
        sendResponse({ ok: false, error: "NO_UID" });
        return;
      }

      // --------- Helpers ---------
      function norm(s) {
        return (s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .replace(/[\[\(].*?[\]\)]/g, " ")
          .replace(/(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g, " ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      }

      const season = ctx.season ?? 1;
      const mapKey = `${norm(ctx.title)}|s${season}`;

      let animeId = animeLinkMap?.[mapKey]?.animeId ?? null;

      // --------- AUTO RESOLVE IF MISSING ---------
      if (!Number.isFinite(animeId)) {
        const q = `${ctx.title} saison ${season}`;
        const res = await fetch(
          `${API_BASE}/search/anime/${encodeURIComponent(q)}`,
          {
            method: "GET",
            headers: { Authorization: token },
          },
        );

        const data = await safeJson(res);
        const list = data?.data || data;

        if (Array.isArray(list) && list.length > 0) {
          animeId = list[0]?.id ?? null;

          if (Number.isFinite(animeId)) {
            animeLinkMap[mapKey] = {
              animeId,
              season,
              titleRaw: ctx.title,
              ts: Date.now(),
              auto: true,
            };
            await chrome.storage.local.set({ animeLinkMap });
          }
        }
      }

      if (!Number.isFinite(animeId)) {
        sendResponse({ ok: false, error: "ANIME_NOT_FOUND" });
        return;
      }

      // --------- ANTI DOWNGRADE ---------
      const progRes = await fetch(
        `${API_BASE}/progression/anime/${hyakanimeUid}/${animeId}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: token,
          },
        },
      );

      const progData = await safeJson(progRes);
      const known =
        progData?.progression?.progression ??
        progData?.data?.progression?.progression ??
        null;

      if (Number.isFinite(known) && known >= ep) {
        sendResponse({ ok: true, skipped: "ALREADY_UP_TO_DATE" });
        return;
      }

      // --------- WRITE PROGRESSION ---------
      const writeRes = await fetch(`${API_BASE}/progression/anime/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
        body: JSON.stringify({
          id: animeId,
          animeID: animeId,
          progression: ep,
          status: 1,
        }),
      });

      const writeData = await safeJson(writeRes);

      if (!writeRes.ok) {
        sendResponse({ ok: false, error: "WRITE_FAILED", data: writeData });
        return;
      }

      // --------- CLEANUP (TTL 30 days, cap 200) ---------
      const now = Date.now();
      const TTL = 30 * 24 * 60 * 60 * 1000;

      let changed = false;
      for (const [k, v] of Object.entries(animeLinkMap)) {
        if (!v?.ts || now - v.ts > TTL) {
          delete animeLinkMap[k];
          changed = true;
        }
      }

      const entries = Object.entries(animeLinkMap).sort(
        (a, b) => (b[1]?.ts ?? 0) - (a[1]?.ts ?? 0),
      );

      if (entries.length > 200) {
        for (const [k] of entries.slice(200)) {
          delete animeLinkMap[k];
          changed = true;
        }
      }

      if (changed) {
        await chrome.storage.local.set({ animeLinkMap });
      }

      sendResponse({ ok: true, animeId, progression: ep });
      return;
    }

    sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
  })();

  return true; // async response
});

async function getToken() {
  if (cachedToken) return cachedToken;
  const s = await chrome.storage.local.get(["hyakanimeToken"]);
  cachedToken = s.hyakanimeToken || null;
  return cachedToken;
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
