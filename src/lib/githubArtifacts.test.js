import test from "node:test";
import assert from "node:assert/strict";

import {
  pickBestMatchingFileName,
  pickNewestArtifact,
  safeJsonParse,
} from "./githubArtifacts.js";

test("safeJsonParse returns parsed JSON and null for invalid input", () => {
  assert.deepStrictEqual(safeJsonParse('{"ok":true,"count":2}'), { ok: true, count: 2 });
  assert.equal(safeJsonParse("{broken"), null);
  assert.equal(safeJsonParse(42), null);
});

test("pickNewestArtifact prefers the newest non-expired matching artifact", () => {
  const artifacts = [
    {
      name: "coverage-summary",
      created_at: "2024-01-01T10:00:00Z",
    },
    {
      name: "playwright-report-old",
      created_at: "2024-01-02T10:00:00Z",
    },
    {
      name: "playwright-report-new",
      created_at: "2024-01-03T10:00:00Z",
      expired: true,
    },
    {
      name: "playwright-report-latest",
      updated_at: "2024-01-04T10:00:00Z",
    },
  ];

  assert.deepStrictEqual(
    pickNewestArtifact(artifacts, ["playwright"]),
    artifacts[3],
  );
});

test("pickBestMatchingFileName scores the strongest filename match", () => {
  const fileNames = [
    "artifacts/coverage.json",
    "reports/playwright-results.json",
    "reports/playwright-report.json",
  ];

  assert.equal(
    pickBestMatchingFileName(fileNames, ["playwright-report.json"]),
    "reports/playwright-report.json",
  );
});

