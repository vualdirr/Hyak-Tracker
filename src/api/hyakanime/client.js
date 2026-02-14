// src/api/hyakanime/client.js
import { HYAK_SPEC } from "./spec.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger({
  scope: "api:hyakanime",
});

/**
 * Remplace :params dans un path et retire les utilisés du payload.
 */
function buildPath(path, params = {}) {
  return path.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
    const v = params[key];
    if (v == null) throw new Error(`Missing path param: ${key}`);
    return encodeURIComponent(String(v));
  });
}

function toError(code, status, message, details) {
  logger.error("API error", { code, status, message });
  return { ok: false, error: { code, status, message, details } };
}

export function createHyakanimeClient({ baseUrl, getToken }) {
  async function requestByKey(key, input = {}) {
    const start = performance.now();

    logger.debug("requestByKey", { key });

    const def = HYAK_SPEC[key];

    if (key === "progression_write" && input?.__allowUnsafe !== true) {
      logger.warn("Tentative progression_write direct bloquée");
      return {
        ok: false,
        error: {
          code: "FORBIDDEN_DIRECT_WRITE",
          status: 0,
          message:
            "progression_write is forbidden. Use progression.writeSafe() to prevent downgrade.",
        },
      };
    }

    if (!def) {
      logger.error("Endpoint inconnu", { key });
      return toError("UNKNOWN_ENDPOINT", 0, `Unknown endpoint: ${key}`);
    }

    const { params = {}, query = {}, body = null, headers = {} } = input;

    let url;

    try {
      const p = buildPath(def.path, params);
      const qs = new URLSearchParams();

      for (const [k, v] of Object.entries(query || {})) {
        if (v == null) continue;
        qs.set(k, String(v));
      }

      url = baseUrl + p + (qs.toString() ? `?${qs.toString()}` : "");
    } catch (e) {
      logger.warn("Erreur buildPath", { key, message: e?.message });
      return toError("BAD_ARGS", 0, e?.message || "Bad args");
    }

    const h = { Accept: "application/json", ...headers };

    if (def.auth === "token") {
      const token = await getToken();
      if (!token) {
        logger.warn("Token requis mais absent", { key });
        return toError("NO_TOKEN", 401, "No Hyakanime token");
      }

      h.Authorization = token.startsWith("Bearer ") ? token : token;
    }

    if (body != null && def.method !== "GET") {
      h["Content-Type"] = "application/json";
    }

    let res, text, json;

    try {
      logger.debug("Fetch API", {
        method: def.method,
        key,
      });

      res = await fetch(url, {
        method: def.method,
        headers: h,
        body:
          body != null && def.method !== "GET"
            ? JSON.stringify(body)
            : undefined,
      });

      text = await res.text();
      json = text ? safeJson(text) : null;
    } catch (e) {
      logger.error("Network error", {
        key,
        message: e?.message,
      });
      return toError("NETWORK_ERROR", 0, e?.message || "Network error");
    }

    const duration = (performance.now() - start).toFixed(1);

    if (!res.ok) {
      logger.error("HTTP error", {
        key,
        status: res.status,
        durationMs: duration,
      });

      return toError(
        "HTTP_ERROR",
        res.status,
        (json && json.message) || res.statusText || "Request failed",
        json,
      );
    }

    logger.info("API success", {
      key,
      status: res.status,
      durationMs: duration,
    });

    const normalized = def.normalize ? def.normalize(json) : json;

    return { ok: true, data: normalized };
  }

  return { requestByKey };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
