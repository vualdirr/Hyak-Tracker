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

export async function getToken() {
  return await sendMessage({ type: "GET_TOKEN" });
}
