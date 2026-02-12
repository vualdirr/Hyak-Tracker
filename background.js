import { createHyakApi } from "./src/api/hyakanime/index.js";

let cachedToken = null;

const hyakApi = createHyakApi({
  getToken: async () => {
    if (cachedToken) return cachedToken;
    const s = await chrome.storage.local.get(["hyakanimeToken"]);
    cachedToken = s.hyakanimeToken || null;
    return cachedToken;
  },
});

self.hyakApi = hyakApi;

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
    try {
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
        const q = msg.query || "";
        const r = await hyakApi.search.anime(q); // wrapper
        sendResponse(r); // { ok, data } déjà normalisé
        return;
      }

      // ----- WRITE PROGRESSION -----
      if (msg?.type === "WRITE_PROGRESSION") {
        const wanted = Number.parseInt(msg.progression, 10);
        const animeId = Number.parseInt(msg.animeID ?? msg.id, 10);

        if (
          !Number.isFinite(wanted) ||
          wanted <= 0 ||
          !Number.isFinite(animeId)
        ) {
          sendResponse({ ok: false, error: "BAD_ARGS" });
          return;
        }

        // uid : comme avant (fallback storage)
        let uid = msg.uid;
        if (!uid) {
          const s = await chrome.storage.local.get(["hyakanimeUid"]);
          uid = s.hyakanimeUid || null;
        }
        if (!uid) {
          sendResponse({ ok: false, error: "NO_UID" });
          return;
        }

        const r = await hyakApi.progression.writeSafe({
          uid,
          animeId,
          episode: wanted,
          status: msg.status ?? 1,
          extra: {
            lastChange: msg.lastChange ?? undefined,
            startDate: msg.startDate ?? undefined,
            endDate: msg.endDate ?? undefined,
          },
        });

        // si tu veux garder ton ancien shape de réponse :
        if (!r.ok) {
          sendResponse({
            ok: false,
            status: r.error?.status ?? 0,
            error: r.error,
          });
          return;
        }

        // r.data peut être "skipped" ou une réponse API write
        sendResponse({ ok: true, status: 200, data: r.data });
        return;
      }

      // ----- GET PROGRESSION -----
      if (msg?.type === "GET_PROGRESSION_ANIME") {
        const uid = msg.uid;
        const animeId = Number.parseInt(msg.animeId, 10);

        if (!uid || !Number.isFinite(animeId)) {
          sendResponse({ ok: false, error: "BAD_ARGS" });
          return;
        }

        const r = await hyakApi.progression.detail({ uid, animeId });

        // Compat { ok, status, data }
        if (!r.ok) {
          sendResponse({
            ok: false,
            status: r.error?.status ?? 0,
            data: null,
            error: r.error,
          });
          return;
        }

        sendResponse({ ok: true, status: 200, data: r.data });
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
            .replace(
              /(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g,
              " ",
            )
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        }

        const season = ctx.season ?? 1;
        const mapKey = `${norm(ctx.title)}|s${season}`;

        let animeId = animeLinkMap?.[mapKey]?.animeId ?? null;
        animeId = Number.parseInt(animeId, 10);

        // --------- AUTO RESOLVE IF MISSING (via wrapper) ---------
        if (!Number.isFinite(animeId)) {
          const q = `${ctx.title} saison ${season}`;

          // Wrapper search => data normalisée: [{ id, displayTitle, titles, ... }]
          const sr = await hyakApi.search.anime(q);

          if (sr.ok && Array.isArray(sr.data) && sr.data.length > 0) {
            animeId = sr.data[0]?.id ?? null;
            animeId = Number.parseInt(animeId, 10);

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

        // --------- WRITE (anti-downgrade obligatoire via wrapper) ---------
        const wr = await hyakApi.progression.writeSafe({
          uid: hyakanimeUid,
          animeId,
          episode: ep,
          status: 1,
        });

        // writeSafe peut répondre:
        // - ok:true + data.skipped... (déjà à jour)
        // - ok:true + data (réponse write)
        // - ok:false + error
        if (!wr.ok) {
          sendResponse({ ok: false, error: "WRITE_FAILED", details: wr.error });
          return;
        }

        await cleanupAnimeLinkMap();

        // --------- Reply ---------
        // On garde ton format de réponse + on ajoute info skipped si besoin
        sendResponse({
          ok: true,
          animeId,
          progression: ep,
          skipped: wr.data?.skipped ?? undefined,
          known: wr.data?.known ?? undefined,
          wanted: wr.data?.wanted ?? undefined,
        });
        return;
      }

      sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
    } catch (err) {
      console.error("Background error:", err);
      sendResponse({ ok: false, error: "INTERNAL_ERROR" });
    }
  })();

  return true; // async response
});
