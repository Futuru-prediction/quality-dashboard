import test from "node:test";
import assert from "node:assert/strict";

import handler from "./sentry-whatsapp-webhook.js";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function makeReq({
  method = "POST",
  headers = {},
  query = {},
  body = {},
} = {}) {
  return { method, headers, query, body };
}

function makeRes() {
  const out = {
    headers: {},
    statusCode: 200,
    payload: null,
  };

  return {
    setHeader(name, value) {
      out.headers[name] = value;
    },
    status(code) {
      out.statusCode = code;
      return {
        json(payload) {
          out.payload = payload;
          return payload;
        },
      };
    },
    out,
  };
}

function setBaseProviderEnv() {
  process.env.SENTRY_TO_WHATSAPP_SECRET = "super-secret";
  process.env.ZAPI_INSTANCE_ID = "instance-id";
  process.env.ZAPI_INSTANCE_TOKEN = "instance-token";
  process.env.ZAPI_CLIENT_TOKEN = "client-token";
  process.env.WHATSAPP_ALERT_DESTINATIONS = "5511999999999,1203@g.us";
}

test.afterEach(() => {
  restoreEnv();
  global.fetch = ORIGINAL_FETCH;
});

test("returns 405 for non-POST requests", async () => {
  const req = makeReq({ method: "GET" });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 405);
  assert.equal(res.out.headers.Allow, "POST");
  assert.equal(res.out.payload.error, "method_not_allowed");
});

test("returns 500 when bridge secret env is missing", async () => {
  const req = makeReq({
    query: { secret: "any" },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 500);
  assert.equal(res.out.payload.error, "missing_env");
  assert.equal(res.out.payload.detail, "SENTRY_TO_WHATSAPP_SECRET");
});

test("returns 401 when secret is invalid", async () => {
  process.env.SENTRY_TO_WHATSAPP_SECRET = "expected-secret";

  const req = makeReq({
    query: { secret: "wrong-secret" },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 401);
  assert.equal(res.out.payload.error, "unauthorized");
});

test("returns 400 when sentry-hook-resource header is invalid", async () => {
  process.env.SENTRY_TO_WHATSAPP_SECRET = "expected-secret";

  const req = makeReq({
    headers: { "sentry-hook-resource": "issue" },
    query: { secret: "expected-secret" },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 400);
  assert.equal(res.out.payload.error, "invalid_sentry_resource");
  assert.equal(res.out.payload.detail, "issue");
});

test("returns 500 when provider env vars are missing", async () => {
  process.env.SENTRY_TO_WHATSAPP_SECRET = "expected-secret";

  const req = makeReq({
    headers: { "sentry-hook-resource": "event.alert" },
    query: { secret: "expected-secret" },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 500);
  assert.equal(res.out.payload.error, "missing_env");
  assert.deepEqual(
    res.out.payload.detail,
    ["ZAPI_INSTANCE_ID", "ZAPI_INSTANCE_TOKEN", "WHATSAPP_ALERT_DESTINATIONS"],
  );
});

test("returns 200 when all provider sends succeed", async () => {
  setBaseProviderEnv();

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ messageId: "msg-123" }),
  });

  const req = makeReq({
    headers: { "sentry-hook-resource": "event.alert" },
    query: { secret: "super-secret" },
    body: {
      action: "triggered",
      data: {
        triggered_rule: "Rule A",
        event: {
          title: "Synthetic alert",
          environment: "production",
          release: "sha-1",
          web_url: "https://example.sentry.io/issues/1",
        },
      },
    },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.payload.ok, true);
  assert.equal(res.out.payload.sentCount, 2);
  assert.equal(res.out.payload.totalCount, 2);
  assert.equal(res.out.payload.results.length, 2);
});

test("returns 502 when at least one provider send fails", async () => {
  setBaseProviderEnv();
  process.env.WHATSAPP_ALERT_DESTINATIONS = "5511999999999,5511888888888";

  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ messageId: "ok-1" }),
      };
    }

    return {
      ok: false,
      status: 500,
      json: async () => ({ error: "provider_failed" }),
    };
  };

  const req = makeReq({
    headers: { "sentry-hook-resource": "event.alert" },
    query: { secret: "super-secret" },
    body: {
      action: "triggered",
      data: {
        triggered_rule: "Rule B",
        event: {
          title: "Synthetic partial failure",
          environment: "production",
          release: "sha-2",
        },
      },
    },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 502);
  assert.equal(res.out.payload.ok, false);
  assert.equal(res.out.payload.sentCount, 1);
  assert.equal(res.out.payload.totalCount, 2);
  assert.equal(res.out.payload.results[1].ok, false);
});

test("returns 502 with timeout metadata when provider request aborts", async () => {
  setBaseProviderEnv();
  process.env.WHATSAPP_ALERT_DESTINATIONS = "5511999999999";
  process.env.SENTRY_TO_WHATSAPP_TIMEOUT_MS = "1200";

  global.fetch = async () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    throw error;
  };

  const req = makeReq({
    headers: { "sentry-hook-resource": "event.alert" },
    query: { secret: "super-secret" },
    body: {
      action: "triggered",
      data: {
        triggered_rule: "Rule Timeout",
        event: {
          title: "Synthetic timeout",
          environment: "production",
          release: "sha-timeout",
        },
      },
    },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 502);
  assert.equal(res.out.payload.ok, false);
  assert.equal(res.out.payload.totalCount, 1);
  assert.equal(res.out.payload.results[0].ok, false);
  assert.equal(res.out.payload.results[0].status, 504);
  assert.equal(res.out.payload.results[0].errorType, "timeout");
  assert.equal(res.out.payload.results[0].payload.error, "provider_timeout");
});

test("returns 502 with network metadata when provider request fails before response", async () => {
  setBaseProviderEnv();
  process.env.WHATSAPP_ALERT_DESTINATIONS = "5511999999999";

  global.fetch = async () => {
    throw new Error("getaddrinfo ENOTFOUND api.z-api.io");
  };

  const req = makeReq({
    headers: { "sentry-hook-resource": "event.alert" },
    query: { secret: "super-secret" },
    body: {
      action: "triggered",
      data: {
        triggered_rule: "Rule Network",
        event: {
          title: "Synthetic network failure",
          environment: "production",
          release: "sha-network",
        },
      },
    },
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.out.statusCode, 502);
  assert.equal(res.out.payload.ok, false);
  assert.equal(res.out.payload.totalCount, 1);
  assert.equal(res.out.payload.results[0].ok, false);
  assert.equal(res.out.payload.results[0].status, 502);
  assert.equal(res.out.payload.results[0].errorType, "network");
  assert.equal(res.out.payload.results[0].payload.error, "provider_unreachable");
});
