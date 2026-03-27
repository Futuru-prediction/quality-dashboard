import test from "node:test";
import assert from "node:assert/strict";

import {
  filterIssuesByScope,
  summarizeRunsByScope,
} from "./dashboardMetrics.js";

test("filterIssuesByScope keeps only Quality Dashboard labels by default", () => {
  const issues = [
    {
      id: "1",
      labels: { nodes: [{ name: "Quality Dashboard" }, { name: "Bug" }] },
    },
    {
      id: "2",
      labels: { nodes: [{ name: "CRM" }, { name: "Feature" }] },
    },
    {
      id: "3",
      labels: { nodes: [{ name: "quality dashboard / ux" }] },
    },
  ];

  assert.deepStrictEqual(
    filterIssuesByScope(issues, "quality").map(issue => issue.id),
    ["1", "3"],
  );
  assert.deepStrictEqual(
    filterIssuesByScope(issues, "global").map(issue => issue.id),
    ["1", "2", "3"],
  );
});

test("summarizeRunsByScope separates global and active repository metrics", () => {
  const runs = [
    { repoName: "futuru-frontend", conclusion: "success" },
    { repoName: "futuru-frontend", conclusion: "failure" },
    { repoName: "futuru-k6", conclusion: "success" },
    { repoName: "futuru-core", conclusion: "failure" },
  ];

  const summary = summarizeRunsByScope(runs, "futuru-frontend");

  assert.deepStrictEqual(summary.global, {
    passed: 2,
    failed: 2,
    total: 4,
  });
  assert.deepStrictEqual(summary.active, {
    passed: 1,
    total: 2,
    ratePct: 50,
  });
});

