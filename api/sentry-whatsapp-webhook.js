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

const ZAPI_BASE_URL = "https://api.z-api.io";

function splitDestinations(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolve(obj, paths, fallback = "") {
  for (const path of paths) {
    const value = path.reduce(
      (acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined),
      obj,
    );
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function parsePayloadBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

function buildAlertMessage(payload) {
  const action = resolve(payload, [["action"]], "triggered");
  const rule = resolve(payload, [
    ["data", "triggered_rule"],
    ["triggered_rule"],
    ["data", "rule", "name"],
    ["rule", "name"],
  ], "unknown-rule");
  const project = resolve(payload, [
    ["project", "slug"],
    ["project", "name"],
    ["data", "event", "project"],
  ], "unknown-project");
  const title = resolve(payload, [
    ["data", "event", "title"],
    ["data", "event", "metadata", "title"],
    ["event", "title"],
    ["title"],
  ], "Sentry alert");
  const level = resolve(payload, [
    ["data", "event", "level"],
    ["event", "level"],
    ["level"],
  ], "error");
  const environment = resolve(payload, [
    ["data", "event", "environment"],
    ["event", "environment"],
    ["environment"],
  ], "unknown");
  const release = resolve(payload, [
    ["data", "event", "release"],
    ["event", "release"],
    ["release"],
  ], "unknown");
  const issueUrl = resolve(payload, [
    ["data", "event", "web_url"],
    ["data", "event", "url"],
    ["event", "web_url"],
    ["url"],
  ], "");

  const lines = [
    "Sentry Alert",
    `Action: ${action}`,
    `Rule: ${rule}`,
    `Project: ${project}`,
    `Level: ${level}`,
    `Environment: ${environment}`,
    `Release: ${release}`,
    `Title: ${title}`,
  ];

  if (issueUrl) lines.push(`Link: ${issueUrl}`);

  return lines.join("\n");
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const bridgeSecret = process.env.SENTRY_TO_WHATSAPP_SECRET;
  const sentryResource = req.headers["sentry-hook-resource"] || null;
  const providedSecret =
    req.headers["x-bridge-secret"] ||
    req.query?.secret ||
    req.body?.secret ||
    null;

  if (!bridgeSecret) {
    return res.status(500).json({
      ok: false,
      error: "missing_env",
      detail: "SENTRY_TO_WHATSAPP_SECRET",
    });
  }

  if (providedSecret !== bridgeSecret) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  if (sentryResource && sentryResource !== "event.alert") {
    return res.status(400).json({
      ok: false,
      error: "invalid_sentry_resource",
      detail: sentryResource,
    });
  }

  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN || "";
  const destinations = splitDestinations(process.env.WHATSAPP_ALERT_DESTINATIONS);

  if (!instanceId || !instanceToken || destinations.length === 0) {
    return res.status(500).json({
      ok: false,
      error: "missing_env",
      detail: [
        !instanceId ? "ZAPI_INSTANCE_ID" : null,
        !instanceToken ? "ZAPI_INSTANCE_TOKEN" : null,
        destinations.length === 0 ? "WHATSAPP_ALERT_DESTINATIONS" : null,
      ].filter(Boolean),
    });
  }

  const payload = parsePayloadBody(req.body);
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
  }

  const hasFailures = results.some((result) => !result.ok);
  const statusCode = hasFailures ? 502 : 200;

  return res.status(statusCode).json({
    ok: !hasFailures,
    sentCount: results.filter((result) => result.ok).length,
    totalCount: results.length,
    results,
    meta: {
      sentryResource,
      sentryTimestamp: req.headers["sentry-hook-timestamp"] || null,
    },
  });
}
