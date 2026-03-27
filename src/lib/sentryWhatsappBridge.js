function safeParseJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function splitDestinations(raw) {
  return String(raw || "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolve(obj, paths, fallback = "") {
  for (const path of paths) {
    const value = path.reduce(
      (acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined),
      obj,
    );
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

export function parseIncomingPayload(body) {
  if (!body) return {};

  if (typeof body === "string") {
    const parsed = safeParseJson(body);
    return parsed && typeof parsed === "object" ? parseIncomingPayload(parsed) : {};
  }

  if (typeof body !== "object") return {};

  if (typeof body.payload === "string") {
    const payload = safeParseJson(body.payload);
    if (payload && typeof payload === "object") return parseIncomingPayload(payload);
  }

  if (body.payload && typeof body.payload === "object") {
    return parseIncomingPayload(body.payload);
  }

  if (typeof body.data === "string") {
    const parsedData = safeParseJson(body.data);
    if (parsedData && typeof parsedData === "object") {
      return { ...body, data: parsedData };
    }
  }

  return body;
}

export function extractAlertMetadata(payload) {
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

  const action = resolve(payload, [["action"]], "triggered");

  return {
    action,
    rule,
    project,
    environment,
    release,
  };
}

export function buildAlertMessage(payload) {
  const metadata = extractAlertMetadata(payload);

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

  const issueUrl = resolve(payload, [
    ["data", "event", "web_url"],
    ["data", "event", "url"],
    ["event", "web_url"],
    ["url"],
  ], "");

  const lines = [
    "Sentry Alert",
    `Action: ${metadata.action}`,
    `Rule: ${metadata.rule}`,
    `Project: ${metadata.project}`,
    `Level: ${level}`,
    `Environment: ${metadata.environment}`,
    `Release: ${metadata.release}`,
    `Title: ${title}`,
  ];

  if (issueUrl) lines.push(`Link: ${issueUrl}`);

  return lines.join("\n");
}
