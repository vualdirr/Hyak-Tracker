// E:\Hyak-Tracker\src\popup\services\runtime.js
export async function sendMessage(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    return {
      ok: false,
      error: "SEND_MESSAGE_FAILED",
      details: String(e?.message || e),
    };
  }
}

export async function getStreamContext(tabId) {
  const res = await sendMessage({ type: "GET_STREAM_CONTEXT", tabId });
  return res?.ok ? res.ctx || null : null;
}

export async function getSession() {
  const res = await sendMessage({ type: "GET_SESSION" });

  if (!res?.ok) {
    return { ok: false, authenticated: false, uid: null };
  }

  return {
    ok: true,
    authenticated: !!res.authenticated,
    uid: res.uid || null,
  };
}

// ----- LOGS (background store) -----
export async function getCurrentLogs(tabId) {
  const res = await sendMessage({ type: "LOG_GET_CURRENT", tabId });
  return res?.ok
    ? { ok: true, siteKey: res.siteKey || "", logs: res.logs || [] }
    : { ok: false, error: res?.error || "LOG_GET_FAILED", details: res };
}

export async function clearCurrentLogs(tabId) {
  const res = await sendMessage({ type: "LOG_CLEAR_CURRENT", tabId });
  return res?.ok
    ? { ok: true }
    : { ok: false, error: res?.error || "LOG_CLEAR_FAILED", details: res };
}

export async function pushLog({
  level,
  kind = "log", // ⭐ NEW
  scope,
  message,
  data,
  siteKey,
  url,
  tabId,
}) {
  const res = await sendMessage({
    type: "LOG_PUSH",
    level,
    kind, // ✅ forward au background
    scope,
    message,
    data,
    siteKey,
    url,
    tabId, // utile côté popup (sender.tab absent)
  });

  return res?.ok
    ? { ok: true }
    : { ok: false, error: res?.error || "LOG_PUSH_FAILED", details: res };
}
