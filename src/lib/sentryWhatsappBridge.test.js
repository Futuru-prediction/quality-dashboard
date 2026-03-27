import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAlertMessage,
  extractAlertMetadata,
  parseIncomingPayload,
  splitDestinations,
} from "./sentryWhatsappBridge.js";

test("splitDestinations supports comma, semicolon and new lines", () => {
  const destinations = splitDestinations("5511999999999,1203@g.us;5511888888888\n5511777777777");
  assert.deepEqual(destinations, [
    "5511999999999",
    "1203@g.us",
    "5511888888888",
    "5511777777777",
  ]);
});

test("parseIncomingPayload parses raw JSON string payload", () => {
  const payload = parseIncomingPayload(
    "{\"action\":\"triggered\",\"data\":{\"triggered_rule\":\"Rule A\"}}",
  );
  assert.equal(payload.action, "triggered");
  assert.equal(payload.data.triggered_rule, "Rule A");
});

test("parseIncomingPayload supports body.payload wrapper", () => {
  const payload = parseIncomingPayload({
    payload: "{\"action\":\"triggered\",\"data\":{\"triggered_rule\":\"Rule B\"}}",
  });
  assert.equal(payload.action, "triggered");
  assert.equal(payload.data.triggered_rule, "Rule B");
});

test("parseIncomingPayload parses string data field when payload has data as string", () => {
  const payload = parseIncomingPayload({
    action: "triggered",
    data: "{\"triggered_rule\":\"Rule C\",\"event\":{\"environment\":\"production\"}}",
  });
  assert.equal(payload.action, "triggered");
  assert.equal(payload.data.triggered_rule, "Rule C");
  assert.equal(payload.data.event.environment, "production");
});

test("extractAlertMetadata returns normalized fields with fallback defaults", () => {
  const metadata = extractAlertMetadata({
    action: "resolved",
    data: {
      triggered_rule: "Rule D",
      event: {
        project: "javascript-react",
        environment: "production",
        release: "abc123",
      },
    },
  });

  assert.equal(metadata.action, "resolved");
  assert.equal(metadata.rule, "Rule D");
  assert.equal(metadata.project, "javascript-react");
  assert.equal(metadata.environment, "production");
  assert.equal(metadata.release, "abc123");
});

test("buildAlertMessage includes key fields and link when available", () => {
  const message = buildAlertMessage({
    action: "triggered",
    data: {
      triggered_rule: "Rule E",
      event: {
        project: "javascript-react",
        title: "Canary failed",
        level: "error",
        environment: "production",
        release: "sha123",
        web_url: "https://example.sentry.io/issues/1",
      },
    },
  });

  assert.match(message, /Sentry Alert/);
  assert.match(message, /Rule: Rule E/);
  assert.match(message, /Environment: production/);
  assert.match(message, /Release: sha123/);
  assert.match(message, /Title: Canary failed/);
  assert.match(message, /Link: https:\/\/example\.sentry\.io\/issues\/1/);
});
