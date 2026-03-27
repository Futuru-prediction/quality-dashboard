/**
 * Sentry Service Hook (event.alert) -> WhatsApp via Z-API bridge.
 *
 * Expected Vercel env vars:
 * - SENTRY_TO_WHATSAPP_SECRET
 * - ZAPI_INSTANCE_ID
 * - ZAPI_INSTANCE_TOKEN
 * - ZAPI_CLIENT_TOKEN (optional if disabled in Z-API account)
 * - WHATSAPP_ALERT_DESTINATIONS (comma-separated numbers/group IDs)
 */

import {
  buildAlertMessage,
  extractAlertMetadata,
  parseIncomingPayload,
  splitDestinations,
} from "../src/lib/sentryWhatsappBridge.js";

const ZAPI_BASE_URL = "https://api.z-api.io";

function createRequestId(req) {
  const externalId = req.headers["x-request-id"];
  if (typeof externalId === "string" && externalId.trim()) return externalId.trim();
  return `s2w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logBridgeEvent(level, payload) {
  const logger = level === "error" ? console.error : console.log;
  logger(JSON.stringify({ scope: "sentry-whatsapp-bridge", ...payload }));
}

async function sendZApiTextMessage({ instanceId, instanceToken, clientToken, phone, message }) {
  const endpoint = `${ZAPI_BASE_URL}/instances/${instanceId}/token/${instanceToken}/send-text`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (clientToken) headers["Client-Token"] = clientToken;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone, message }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

export default async function handler(req, res) {
  const requestId = createRequestId(req);
  const sentryResource = req.headers["sentry-hook-resource"] || null;
  const sentryTimestamp = req.headers["sentry-hook-timestamp"] || null;

  if (req.method !== "POST") {
    logBridgeEvent("info", {
      event: "request_rejected_method",
      requestId,
      method: req.method,
      sentryResource,
    });
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed", requestId });
  }

  const bridgeSecret = process.env.SENTRY_TO_WHATSAPP_SECRET;
  const providedSecret =
    req.headers["x-bridge-secret"] ||
    req.query?.secret ||
    req.body?.secret ||
    null;

  if (!bridgeSecret) {
    logBridgeEvent("error", {
      event: "missing_env_secret",
      requestId,
      sentryResource,
    });
    return res.status(500).json({
      ok: false,
      error: "missing_env",
      detail: "SENTRY_TO_WHATSAPP_SECRET",
      requestId,
    });
  }

  if (providedSecret !== bridgeSecret) {
    logBridgeEvent("info", {
      event: "request_rejected_secret",
      requestId,
      sentryResource,
    });
    return res.status(401).json({ ok: false, error: "unauthorized", requestId });
  }

  if (sentryResource && sentryResource !== "event.alert") {
    logBridgeEvent("info", {
      event: "request_rejected_resource",
      requestId,
      sentryResource,
    });
    return res.status(400).json({
      ok: false,
      error: "invalid_sentry_resource",
      detail: sentryResource,
      requestId,
    });
  }

  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN || "";
  const destinations = splitDestinations(process.env.WHATSAPP_ALERT_DESTINATIONS);

  if (!instanceId || !instanceToken || destinations.length === 0) {
    const missingDetail = [
      !instanceId ? "ZAPI_INSTANCE_ID" : null,
      !instanceToken ? "ZAPI_INSTANCE_TOKEN" : null,
      destinations.length === 0 ? "WHATSAPP_ALERT_DESTINATIONS" : null,
    ].filter(Boolean);

    logBridgeEvent("error", {
      event: "missing_env_provider",
      requestId,
      sentryResource,
      missingDetail,
    });

    return res.status(500).json({
      ok: false,
      error: "missing_env",
      detail: missingDetail,
      requestId,
    });
  }

  const payload = parseIncomingPayload(req.body);
  const metadata = extractAlertMetadata(payload);
  const { rule, environment, release } = metadata;

  logBridgeEvent("info", {
    event: "request_accepted",
    requestId,
    sentryResource,
    sentryTimestamp,
    rule,
    environment,
    release,
    destinationCount: destinations.length,
  });

  const message = buildAlertMessage(payload);

  const results = [];
  for (const phone of destinations) {
    // Sequential sends keep provider rate behavior predictable for small fan-out.
    const sendResult = await sendZApiTextMessage({
      instanceId,
      instanceToken,
      clientToken,
      phone,
      message,
    });
    results.push({ phone, ...sendResult });

    logBridgeEvent(sendResult.ok ? "info" : "error", {
      event: "provider_send_result",
      requestId,
      phone,
      providerStatus: sendResult.status,
      providerOk: sendResult.ok,
      providerMessageId:
        sendResult.payload?.messageId || sendResult.payload?.id || null,
    });
  }

  const hasFailures = results.some((result) => !result.ok);
  const statusCode = hasFailures ? 502 : 200;

  logBridgeEvent(hasFailures ? "error" : "info", {
    event: "request_completed",
    requestId,
    sentCount: results.filter((result) => result.ok).length,
    totalCount: results.length,
    statusCode,
    ...metadata,
  });

  return res.status(statusCode).json({
    ok: !hasFailures,
    requestId,
    sentCount: results.filter((result) => result.ok).length,
    totalCount: results.length,
    results,
    meta: {
      ...metadata,
      sentryResource,
      sentryTimestamp,
    },
  });
}
