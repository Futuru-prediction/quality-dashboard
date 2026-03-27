export const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

export const PLAYWRIGHT_ARTIFACT_NAME_HINTS = [
  "playwright-json-report",
  "playwright-json",
  "playwright-report",
  "playwright-results",
  "playwright",
  "smoke-results-json",
  "critical-results-json",
  "results-json",
  "results",
];

export const COVERAGE_ARTIFACT_NAME_HINTS = [
  "coverage-summary",
  "coverage-final",
  "coverage",
  "lcov",
  "summary",
];

export const PLAYWRIGHT_JSON_FILE_HINTS = [
  "results.json",
  "report.json",
  "playwright-report.json",
  "playwright-results.json",
  "playwright.json",
  "json-report.json",
  "test-results.json",
  "summary.json",
];

export const COVERAGE_JSON_FILE_HINTS = [
  "coverage-summary.json",
  "coverage-final.json",
  "summary.json",
  "coverage.json",
  "lcov.json",
];

function getArtifactTimestamp(artifact) {
  const raw = artifact?.created_at || artifact?.updated_at || artifact?.expires_at || "";
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function scoreFileName(fileName, hints) {
  const normalizedName = normalizeText(fileName);
  if (!normalizedName) return -1;

  const baseName = normalizedName.split("/").pop() || normalizedName;
  let bestScore = -1;

  for (const hint of hints) {
    const normalizedHint = normalizeText(hint);
    if (!normalizedHint) continue;

    if (normalizedName === normalizedHint) bestScore = Math.max(bestScore, 100);
    if (baseName === normalizedHint) bestScore = Math.max(bestScore, 95);
    if (baseName.endsWith(normalizedHint)) bestScore = Math.max(bestScore, 90);
    if (normalizedName.endsWith(`/${normalizedHint}`)) bestScore = Math.max(bestScore, 80);
    if (normalizedName.includes(normalizedHint)) bestScore = Math.max(bestScore, 50);
  }

  return bestScore;
}

export function safeJsonParse(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function pickNewestArtifact(artifacts, hints = []) {
  return (Array.isArray(artifacts) ? artifacts : [])
    .filter(artifact => artifact && artifact.expired !== true)
    .filter(artifact => {
      if (!hints.length) return true;
      const name = normalizeText(artifact?.name);
      return hints.some(hint => name.includes(normalizeText(hint)));
    })
    .sort((a, b) => {
      const diff = getArtifactTimestamp(b) - getArtifactTimestamp(a);
      if (diff !== 0) return diff;
      return normalizeText(String(b?.name || "")).localeCompare(normalizeText(String(a?.name || "")));
    })[0] || null;
}

export function pickBestMatchingFileName(fileNames, hints = []) {
  const ranked = (Array.isArray(fileNames) ? fileNames : [])
    .map(fileName => ({ fileName, score: scoreFileName(fileName, hints) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const nameDiff = a.fileName.length - b.fileName.length;
      if (nameDiff !== 0) return nameDiff;
      return normalizeText(a.fileName).localeCompare(normalizeText(b.fileName));
    });

  return ranked[0]?.fileName || null;
}
