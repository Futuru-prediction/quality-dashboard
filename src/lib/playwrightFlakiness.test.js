import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateFlakyTests,
  extractPlaywrightTestCases,
  normalizePlaywrightStatus,
} from "./playwrightFlakiness.js";

test("normalizePlaywrightStatus maps common Playwright statuses", () => {
  assert.equal(normalizePlaywrightStatus("PASSED"), "passed");
  assert.equal(normalizePlaywrightStatus("timeout"), "failed");
  assert.equal(normalizePlaywrightStatus("Flaky"), "flaky");
  assert.equal(normalizePlaywrightStatus("cancelled"), "skipped");
  assert.equal(normalizePlaywrightStatus(null), null);
});

test("extractPlaywrightTestCases flattens nested suites and derives statuses", () => {
  const report = {
    projectName: "Quality Dashboard",
    fileName: "playwright-report.json",
    suites: [
      {
        title: "checkout",
        tests: [
          {
            title: "saves cart",
            results: [{ status: "passed" }],
          },
        ],
        specs: [
          {
            name: "pricing",
            tests: [
              {
                name: "shows total",
                location: { file: "tests/pricing.spec.ts" },
                results: [{ status: "failed" }],
              },
            ],
          },
        ],
      },
    ],
  };

  assert.deepStrictEqual(extractPlaywrightTestCases(report), [
    {
      key: "quality dashboard > playwright-report.json > checkout > pricing > shows total > tests/pricing.spec.ts",
      name: "Quality Dashboard > playwright-report.json > checkout > pricing > shows total > tests/pricing.spec.ts",
      status: "failed",
    },
    {
      key: "quality dashboard > playwright-report.json > checkout > saves cart",
      name: "Quality Dashboard > playwright-report.json > checkout > saves cart",
      status: "passed",
    },
  ]);
});

test("aggregateFlakyTests keeps tests with at least 2 failures and 1 pass", () => {
  const runs = [
    {
      createdAt: "2024-03-03T00:00:00Z",
      runName: "Run 3",
      runUrl: "https://example.com/runs/3",
      tests: [
        { key: "a", name: "A", status: "failed" },
        { key: "a", name: "A", status: "passed" },
        { key: "b", name: "B", status: "passed" },
      ],
    },
    {
      createdAt: "2024-03-02T00:00:00Z",
      runName: "Run 2",
      runUrl: "https://example.com/runs/2",
      tests: [
        { key: "a", name: "A", status: "failed" },
        { key: "b", name: "B", status: "failed" },
      ],
    },
    {
      createdAt: "2024-03-01T00:00:00Z",
      runName: "Run 1",
      runUrl: "https://example.com/runs/1",
      tests: [
        { key: "a", name: "A", status: "passed" },
        { key: "b", name: "B", status: "passed" },
      ],
    },
  ];

  assert.deepStrictEqual(aggregateFlakyTests(runs), [
    {
      key: "a",
      name: "A",
      failures: 2,
      passes: 2,
      flakyRuns: 1,
      lastFailureAt: "2024-03-03T00:00:00Z",
      lastFailureRunUrl: "https://example.com/runs/3",
      lastFailureRunName: "Run 3",
    },
  ]);
});
