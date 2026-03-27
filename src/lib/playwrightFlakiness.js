import { normalizeText as normalizeArtifactText } from "./githubArtifacts.js";

const normalize = (value) => normalizeArtifactText(value);

function compactParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map(part => {
      if (typeof part === "string") return part.trim();
      if (typeof part === "number" || typeof part === "boolean") return String(part).trim();
      return "";
    })
    .filter(Boolean);
}

export function normalizePlaywrightStatus(status) {
  const value = normalize(status);
  if (!value) return null;

  if (["passed", "success", "ok", "expected"].includes(value)) return "passed";
  if (["failed", "failure", "unexpected", "timedout", "timed_out", "timeout", "errored", "error", "interrupted"].includes(value)) {
    return "failed";
  }
  if (["flaky"].includes(value)) return "flaky";
  if (["skipped", "skip", "disabled", "ignored", "cancelled", "canceled"].includes(value)) return "skipped";
  return value;
}

function deriveRunStatus(test) {
  const statuses = [];

  if (Array.isArray(test?.results)) {
    for (const result of test.results) {
      statuses.push(normalizePlaywrightStatus(result?.status));
    }
  }

  statuses.push(normalizePlaywrightStatus(test?.status));
  statuses.push(normalizePlaywrightStatus(test?.outcome));

  const filtered = statuses.filter(Boolean);
  if (!filtered.length) {
    if (typeof test?.ok === "boolean") return test.ok ? "passed" : "failed";
    return null;
  }

  const hasPassed = filtered.includes("passed");
  const hasFailed = filtered.includes("failed");
  const hasFlaky = filtered.includes("flaky");
  const hasSkipped = filtered.every(status => status === "skipped");

  if (hasPassed && hasFailed) return "flaky";
  if (hasFlaky) return "flaky";
  if (hasFailed) return "failed";
  if (hasPassed) return "passed";
  if (hasSkipped) return "skipped";

  return filtered[filtered.length - 1] || null;
}

function buildTestName(contextParts, testName, fallbackName) {
  const parts = compactParts([
    ...contextParts,
    testName,
    fallbackName,
  ]);

  return parts.join(" > ");
}

function collectTestCases(node, context, output, seen) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);

  const nextContext = {
    projectName: context.projectName || compactParts([node.projectName, node.project?.name]).join(" "),
    fileName: context.fileName || compactParts([node.file, node.fileName, node.filePath, node.location?.file, node.location?.fileName]).join(" "),
    pathParts: [...context.pathParts, node.title, node.name].filter(Boolean),
  };

  const hasChildCollections = [
    node.suites,
    node.specs,
    node.tests,
    node.children,
    node.entries,
  ].some(child => Array.isArray(child) && child.length > 0);

  const looksLikeTest = !hasChildCollections && (
    Array.isArray(node.results)
    || typeof node.status === "string"
    || typeof node.outcome === "string"
    || typeof node.ok === "boolean"
  );

  if (looksLikeTest) {
    const status = deriveRunStatus(node);
    const name = buildTestName(
      [nextContext.projectName, nextContext.fileName, ...context.pathParts],
      node.title || node.name || node.fullTitle || node.testId || node.id,
      node.location?.file,
    );

    if (status && normalize(name)) {
      output.push({
        key: normalize(name),
        name,
        status,
      });
    }
  }

  const children = [
    ...(Array.isArray(node.suites) ? node.suites : []),
    ...(Array.isArray(node.specs) ? node.specs : []),
    ...(Array.isArray(node.tests) ? node.tests : []),
    ...(Array.isArray(node.children) ? node.children : []),
    ...(Array.isArray(node.entries) ? node.entries : []),
  ];

  for (const child of children) {
    collectTestCases(child, nextContext, output, seen);
  }
}

export function extractPlaywrightTestCases(report) {
  const cases = [];
  const seen = new Set();

  collectTestCases(report, { projectName: "", fileName: "", pathParts: [] }, cases, seen);

  return cases;
}

function mergeRunStatuses(statuses) {
  const normalized = statuses.map(normalizePlaywrightStatus).filter(Boolean);
  if (!normalized.length) return null;

  const hasPassed = normalized.includes("passed");
  const hasFailed = normalized.includes("failed");
  const hasFlaky = normalized.includes("flaky");
  const hasSkipped = normalized.every(status => status === "skipped");

  if (hasPassed && hasFailed) return "flaky";
  if (hasFlaky) return "flaky";
  if (hasFailed) return "failed";
  if (hasPassed) return "passed";
  if (hasSkipped) return "skipped";

  return normalized[normalized.length - 1] || null;
}

export function aggregateFlakyTests(runs, { limit = 10 } = {}) {
  const sortedRuns = [...(Array.isArray(runs) ? runs : [])]
    .filter(run => run && run.createdAt)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);

  const aggregates = new Map();

  for (const run of sortedRuns) {
    const groupedByTest = new Map();

    for (const testCase of Array.isArray(run.tests) ? run.tests : []) {
      if (!testCase?.key) continue;
      const entry = groupedByTest.get(testCase.key) || {
        key: testCase.key,
        name: testCase.name,
        statuses: [],
      };
      entry.name = entry.name || testCase.name;
      entry.statuses.push(testCase.status);
      groupedByTest.set(testCase.key, entry);
    }

    for (const testCase of groupedByTest.values()) {
      const status = mergeRunStatuses(testCase.statuses);
      if (!status) continue;

      const aggregate = aggregates.get(testCase.key) || {
        key: testCase.key,
        name: testCase.name,
        failures: 0,
        passes: 0,
        flakyRuns: 0,
        lastFailureAt: null,
        lastFailureRunUrl: null,
        lastFailureRunName: null,
      };

      aggregate.name = aggregate.name || testCase.name;

      if (status === "passed") {
        aggregate.passes += 1;
      } else if (status === "failed") {
        aggregate.failures += 1;
      } else if (status === "flaky") {
        aggregate.failures += 1;
        aggregate.passes += 1;
        aggregate.flakyRuns += 1;
      }

      if ((status === "failed" || status === "flaky") && (
        !aggregate.lastFailureAt || Date.parse(run.createdAt) >= Date.parse(aggregate.lastFailureAt)
      )) {
        aggregate.lastFailureAt = run.createdAt;
        aggregate.lastFailureRunUrl = run.runUrl || null;
        aggregate.lastFailureRunName = run.runName || null;
      }

      aggregates.set(testCase.key, aggregate);
    }
  }

  return Array.from(aggregates.values())
    .filter(test => test.failures >= 2 && test.passes >= 1)
    .sort((a, b) => {
      if (b.failures !== a.failures) return b.failures - a.failures;
      const dateDiff = Date.parse(b.lastFailureAt || 0) - Date.parse(a.lastFailureAt || 0);
      if (dateDiff !== 0) return dateDiff;
      return a.name.localeCompare(b.name);
    });
}
