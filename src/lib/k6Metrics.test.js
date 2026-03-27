import test from "node:test";
import assert from "node:assert/strict";

import {
  buildK6TrendSeries,
  parseK6Summary,
  formatK6MetricValue,
  formatK6Delta,
} from "./k6Metrics.js";

test("parseK6Summary normalizes a k6 machine-readable summary", () => {
  const summary = {
    options: {
      summaryTimeUnit: "s",
      thresholds: {
        http_req_duration: ["p(95)<0.5"],
        http_req_failed: ["rate<0.01"],
      },
    },
    state: {
      testRunDurationMs: 31873.45,
    },
    metrics: {
      http_req_duration: {
        type: "trend",
        contains: "time",
        values: {
          "p(95)": 0.42,
          "p(99)": 0.83,
        },
        thresholds: {
          "p(95)<0.5": { ok: true },
        },
      },
      http_req_failed: {
        type: "rate",
        contains: "default",
        values: {
          rate: 0.0125,
        },
        thresholds: {
          "rate<0.01": { ok: false },
        },
      },
      http_reqs: {
        type: "counter",
        contains: "default",
        values: {
          rate: 118.4,
        },
      },
    },
  };

  assert.deepStrictEqual(parseK6Summary(summary), {
    summaryTimeUnit: "s",
    runDurationMs: 31873.45,
    metrics: {
      p95Ms: 420,
      p99Ms: 830,
      errorRatePct: 1.25,
      rps: 118.4,
    },
    thresholds: {
      p95Ms: 500,
      p95Ok: true,
      errorRatePct: 1,
      errorRateOk: false,
    },
    raw: summary,
  });
});

test("buildK6TrendSeries sorts history, trims to 10 runs, and computes baseline", () => {
  const runs = Array.from({ length: 12 }, (_, index) => {
    const n = index + 1;
    return {
      runId: String(n),
      runName: `Run ${n}`,
      runUrl: `https://example.com/runs/${n}`,
      createdAt: `2024-03-${String(n).padStart(2, "0")}T12:00:00Z`,
      metrics: {
        p95Ms: n * 10,
        p99Ms: n * 12,
        errorRatePct: n,
        rps: n * 100,
      },
      thresholds: {
        p95Ms: 500,
      },
    };
  }).reverse();

  const series = buildK6TrendSeries(runs, { limit: 10 });

  assert.equal(series.hasEnoughHistory, true);
  assert.equal(series.history.length, 10);
  assert.equal(series.history[0].runId, "3");
  assert.equal(series.history.at(-1).runId, "12");
  assert.equal(series.thresholdMs, 500);
  assert.deepStrictEqual(series.baseline, {
    p95Ms: 70,
    p99Ms: 84,
    errorRatePct: 7,
    rps: 700,
  });

  assert.equal(series.cards[0].key, "p95");
  assert.equal(series.cards[0].value, 120);
  assert.equal(series.cards[0].baseline, 70);
  assert.equal(series.cards[0].thresholdMs, 500);
});

test("formatK6MetricValue and formatK6Delta render concise labels", () => {
  assert.equal(formatK6MetricValue(0.75, "%"), "0.75%");
  assert.equal(formatK6MetricValue(151.2, "ms"), "151 ms");
  assert.equal(formatK6MetricValue(12.5, "rps"), "12.5");
  assert.equal(formatK6Delta(12.345), "+12.3% vs baseline");
});
