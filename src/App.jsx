import { useState, useCallback, useEffect, useMemo } from "react";
import JSZip from "jszip";
import {
  COVERAGE_ARTIFACT_NAME_HINTS,
  COVERAGE_JSON_FILE_HINTS,
  PLAYWRIGHT_ARTIFACT_NAME_HINTS,
  PLAYWRIGHT_JSON_FILE_HINTS,
  pickBestMatchingFileName,
  pickNewestArtifact,
  safeJsonParse,
} from "./lib/githubArtifacts.js";
import {
  K6_ARTIFACT_NAME_HINTS,
  K6_JSON_FILE_HINTS,
  buildK6TrendSeries,
  parseK6Summary,
} from "./lib/k6Metrics.js";
import {
  aggregateFlakyTests,
  extractPlaywrightTestCases,
} from "./lib/playwrightFlakiness.js";
import {
  filterIssuesByScope,
  summarizeRunsByScope,
} from "./lib/dashboardMetrics.js";
import K6PerformanceSection from "./components/K6PerformanceSection.jsx";

const REPOS = [
  "futuru-frontend",
  "futuru-k6",
  "futuru-core",
  "futuru-bff",
];
const ORG = "Futuru-prediction";
const LINEAR_PROJECT = "FTU";
const QUALITY_DASHBOARD_LABEL = "quality dashboard";
const COVERAGE_THRESHOLDS = {
  "futuru-frontend": 70,
  "futuru-core": 80,
  "futuru-bff": 70,
  "futuru-k6": 70,
};

const COLORS = {
  bg: "#070b14",
  surface: "#111b2e",
  border: "#24324a",
  borderHover: "#314764",
  accent: "#1dd6a5",
  accentDim: "#1dd6a522",
  accentBorder: "#1dd6a566",
  warn: "#f4b455",
  danger: "#ff6b6b",
  info: "#56a7ff",
  text: "#edf3ff",
  textMuted: "#a4b2c8",
  textDim: "#7f8ea5",
  success: "#33d17a",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@500;600;700;800&family=Sora:wght@500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: radial-gradient(1200px 560px at 15% -10%, #123057 0%, transparent 65%), ${COLORS.bg};
    color: ${COLORS.text};
    font-family: 'Manrope', sans-serif;
  }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 2px; }
  input { font-family: 'JetBrains Mono', monospace; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(400%)} }
  button:focus-visible, a:focus-visible, input:focus-visible {
    outline: 2px solid ${COLORS.accentBorder};
    outline-offset: 2px;
  }
`;

const mono = { fontFamily: "'JetBrains Mono', monospace" };

function useViewportWidth() {
  const [width, setWidth] = useState(
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return width;
}

function shouldForceErrorBoundary() {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem("FTU_FORCE_ERROR_BOUNDARY") === "1";
  } catch {
    return false;
  }
}

function Tag({ color = COLORS.accent, children }) {
  return (
    <span style={{
      ...mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
      padding: "3px 8px", borderRadius: 4,
      background: color + "20", color, border: `0.5px solid ${color}40`,
      textTransform: "uppercase",
    }}>{children}</span>
  );
}

function Stat({ label, value, sub, color = COLORS.accent, loading }) {
  return (
    <div style={{
      background: COLORS.surface, border: `0.5px solid ${COLORS.border}`,
      borderRadius: 14, padding: "18px 20px", display: "flex",
      flexDirection: "column", gap: 6, animation: "fadeIn .4s ease",
    }}>
      <span style={{ fontSize: 12, color: COLORS.textMuted, ...mono, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
      {loading
        ? <div style={{ height: 30, background: COLORS.border, borderRadius: 6, animation: "pulse 1.4s infinite" }} />
        : <span style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1, fontFamily: "'Sora', sans-serif" }}>{value ?? "—"}</span>
      }
      {sub && <span style={{ fontSize: 12, color: COLORS.textMuted }}>{sub}</span>}
    </div>
  );
}

function SectionHeader({ icon, title, tag }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em", fontFamily: "'Sora', sans-serif" }}>{title}</span>
      {tag && <Tag>{tag}</Tag>}
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: COLORS.surface, border: `0.5px solid ${COLORS.border}`,
      borderRadius: 16, padding: "24px 24px", animation: "fadeIn .35s ease",
      minWidth: 0,
      ...style,
    }}>{children}</div>
  );
}

function StatusDot({ status }) {
  const map = {
    success: COLORS.success, passed: COLORS.success,
    failed: COLORS.danger, failure: COLORS.danger,
    running: COLORS.warn, pending: COLORS.warn,
    cancelled: COLORS.textMuted, skipped: COLORS.textMuted,
  };
  const color = map[status?.toLowerCase()] || COLORS.textMuted;
  const pulse = ["running", "pending"].includes(status?.toLowerCase());
  return (
    <span style={{
      display: "inline-block", width: 7, height: 7, borderRadius: "50%",
      background: color, flexShrink: 0,
      animation: pulse ? "pulse 1.2s infinite" : "none",
    }} />
  );
}

function Spinner() {
  return (
    <div style={{
      width: 16, height: 16, border: `2px solid ${COLORS.border}`,
      borderTop: `2px solid ${COLORS.accent}`, borderRadius: "50%",
      animation: "spin .8s linear infinite", display: "inline-block",
    }} />
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 0", color: COLORS.textMuted, fontSize: 14 }}>
      {message}
    </div>
  );
}

function SectionErrorNotice({ message, onRetry, disabled = false }) {
  return (
    <div style={{
      marginBottom: 12,
      background: `${COLORS.danger}14`,
      border: `0.5px solid ${COLORS.danger}4a`,
      borderRadius: 8,
      padding: "10px 12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 12, color: COLORS.danger, lineHeight: 1.4 }}>{message}</span>
      <button
        onClick={onRetry}
        disabled={disabled}
        style={{
          background: "transparent",
          border: `0.5px solid ${COLORS.danger}66`,
          color: COLORS.danger,
          borderRadius: 6,
          padding: "4px 9px",
          fontSize: 11,
          cursor: disabled ? "wait" : "pointer",
          opacity: disabled ? 0.6 : 1,
          ...mono,
        }}
      >
        {disabled ? "recarregando..." : "tentar novamente"}
      </button>
    </div>
  );
}

async function ghFetch(path, token) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${path}`);
  return r.json();
}

async function linearFetch(query, token) {
  const r = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`Linear ${r.status}`);
  return r.json();
}

function looksLikePlaywrightReport(value) {
  return !!value && typeof value === "object" && (
    Array.isArray(value.suites)
    || Array.isArray(value.tests)
    || Array.isArray(value.specs)
    || typeof value.stats === "object"
    || typeof value.config === "object"
  );
}

function looksLikeCoverageSummary(value) {
  return !!value && typeof value === "object" && typeof value.total === "object";
}

function looksLikeK6Summary(value) {
  if (!value || typeof value !== "object") return false;
  const metrics = value.metrics && typeof value.metrics === "object" ? value.metrics : value;
  return !!metrics && typeof metrics === "object" && (
    typeof metrics.http_req_duration === "object"
    || typeof metrics.http_req_failed === "object"
    || typeof metrics.http_reqs === "object"
  );
}

function hasK6Metrics(metrics) {
  if (!metrics || typeof metrics !== "object") return false;
  return (
    metrics.p95Ms !== null
    || metrics.p99Ms !== null
    || metrics.errorRatePct !== null
    || metrics.rps !== null
  );
}

function formatK6IngestionReason(reason) {
  if (reason === "missing_artifact") return "artifact k6-summary ausente";
  if (reason === "invalid_summary") return "summary JSON ausente/inválido";
  if (reason === "missing_metrics") return "summary sem métricas esperadas";
  return "causa não identificada";
}

async function fetchJsonFromArtifact(artifact, token, fileHints, validator = null) {
  if (!artifact?.archive_download_url) return null;

  const zipRes = await fetch(artifact.archive_download_url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    redirect: "follow",
  }).catch(() => null);
  if (!zipRes?.ok) return null;

  const zipBuf = await zipRes.arrayBuffer().catch(() => null);
  if (!zipBuf) return null;

  let zip;
  try {
    zip = await JSZip.loadAsync(zipBuf);
  } catch {
    return null;
  }

  const fileNames = Object.values(zip.files)
    .filter(file => !file.dir)
    .map(file => file.name);
  const preferred = pickBestMatchingFileName(fileNames, fileHints);
  const fallback = fileNames.filter(name => name.toLowerCase().endsWith(".json") || name.toLowerCase().includes("json"));
  const ordered = [...new Set([preferred, ...fallback].filter(Boolean))];

  for (const fileName of ordered) {
    const file = zip.file(fileName);
    if (!file) continue;

    const raw = await file.async("text").catch(() => null);
    const parsed = safeJsonParse(raw);
    if (parsed !== null && (!validator || validator(parsed))) return parsed;
  }

  return null;
}

async function fetchK6PerformanceHistory(repo, token, workflowRuns) {
  const completedRuns = (Array.isArray(workflowRuns) ? workflowRuns : [])
    .filter(run => run && run.status === "completed")
    .slice(0, 15);

  const runs = await Promise.all(completedRuns.map(async (run) => {
    const runArtifactsData = await ghFetch(`/repos/${ORG}/${repo}/actions/runs/${run.id}/artifacts?per_page=100`, token)
      .catch(() => ({ artifacts: [] }));
    const runArtifacts = Array.isArray(runArtifactsData?.artifacts) ? runArtifactsData.artifacts : [];
    const summaryArtifact = pickNewestArtifact(runArtifacts, K6_ARTIFACT_NAME_HINTS)
      || pickNewestArtifact(runArtifacts, []);
    const summary = await fetchJsonFromArtifact(summaryArtifact, token, K6_JSON_FILE_HINTS, looksLikeK6Summary)
      .catch(() => null);
    const parsed = parseK6Summary(summary);
    const metrics = parsed?.metrics || null;
    const ingestReason = !summaryArtifact
      ? "missing_artifact"
      : !summary
        ? "invalid_summary"
        : !hasK6Metrics(metrics)
          ? "missing_metrics"
          : "ok";

    return {
      runId: run.id,
      runName: run.name || null,
      runUrl: run.html_url || null,
      createdAt: run.created_at || null,
      conclusion: run.conclusion || run.status || null,
      artifactName: summaryArtifact?.name || null,
      metrics,
      thresholds: parsed?.thresholds || null,
      ingestReason,
    };
  }));

  const validRuns = runs.filter(run => hasK6Metrics(run.metrics));
  const invalidRuns = runs.filter(run => run.ingestReason !== "ok");
  const reasonCounts = invalidRuns.reduce((acc, run) => {
    const reason = run.ingestReason || "unknown";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const primaryReason = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const trend = buildK6TrendSeries(validRuns, { limit: 10 });
  const latestCompletedRun = runs
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;

  return {
    ...trend,
    diagnostics: {
      requiredRuns: 2,
      validRuns: validRuns.length,
      missingRuns: Math.max(0, 2 - validRuns.length),
      totalCompletedRuns: completedRuns.length,
      invalidRuns: invalidRuns.length,
      reasonCounts,
      primaryReason,
      primaryReasonLabel: primaryReason ? formatK6IngestionReason(primaryReason) : null,
      latestRunUrl: latestCompletedRun?.runUrl || null,
      latestRunLabel: latestCompletedRun?.runName || latestCompletedRun?.runId || null,
      checklist: [
        "Garantir upload do artifact com summary JSON no workflow do futuru-k6.",
        "Validar se o arquivo contém http_req_duration, http_req_failed e http_reqs.",
        "Reexecutar o workflow e confirmar no dashboard ao menos 2 runs válidos.",
      ],
    },
  };
}

export default function App() {
  const viewportWidth = useViewportWidth();
  if (shouldForceErrorBoundary()) {
    throw new Error("FTU-244 forced error boundary validation");
  }
  const isMobile = viewportWidth <= 640;
  const isTablet = viewportWidth <= 980;
  const pagePaddingX = isMobile ? 16 : isTablet ? 24 : 40;
  const contentPaddingY = isMobile ? 20 : 30;
  const sectionGap = isMobile ? 20 : 30;
  const statsGridColumns = isMobile
    ? "repeat(2, minmax(0, 1fr))"
    : isTablet
      ? "repeat(3, minmax(0, 1fr))"
      : "repeat(6, minmax(0, 1fr))";
  const dualGridColumns = isTablet ? "1fr" : "1fr 1fr";
  const triGridColumns = isMobile
    ? "1fr"
    : isTablet
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(3, minmax(0, 1fr))";

  const [ghToken, setGhToken] = useState(import.meta.env.VITE_GITHUB_TOKEN || "");
  const [linToken, setLinToken] = useState(import.meta.env.VITE_LINEAR_TOKEN || "");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [activeRepo, setActiveRepo] = useState(REPOS[0]);
  const [issuesScope, setIssuesScope] = useState("quality");
  const [showAllMobileRuns, setShowAllMobileRuns] = useState(false);

  const connect = useCallback(async () => {
    if (!ghToken.trim() || !linToken.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const sectionErrors = {
        github: null,
        coverage: null,
        playwright: null,
        linear: null,
        k6: null,
      };

      const setSectionError = (section, message) => {
        if (!sectionErrors[section]) sectionErrors[section] = message;
      };

      const fetchGithubWithFallback = async (path, fallbackValue, sections, message) => {
        try {
          return await ghFetch(path, ghToken);
        } catch {
          const targets = Array.isArray(sections) ? sections : [sections];
          targets.forEach(section => setSectionError(section, message));
          return fallbackValue;
        }
      };

      const [reposData, linearData] = await Promise.all([
        Promise.all(REPOS.map(async (repo) => {
          const [repoInfo, runs, commits, branches, artifactsData] = await Promise.all([
            fetchGithubWithFallback(
              `/repos/${ORG}/${repo}`,
              null,
              "github",
              "Falha parcial ao carregar dados do GitHub. Alguns blocos podem estar incompletos.",
            ),
            fetchGithubWithFallback(
              `/repos/${ORG}/${repo}/actions/runs?per_page=15`,
              { workflow_runs: [] },
              "github",
              "Falha parcial ao carregar dados do GitHub. Alguns blocos podem estar incompletos.",
            ),
            fetchGithubWithFallback(
              `/repos/${ORG}/${repo}/commits?per_page=5`,
              [],
              "github",
              "Falha parcial ao carregar dados do GitHub. Alguns blocos podem estar incompletos.",
            ),
            fetchGithubWithFallback(
              `/repos/${ORG}/${repo}/branches`,
              [],
              "github",
              "Falha parcial ao carregar dados do GitHub. Alguns blocos podem estar incompletos.",
            ),
            fetchGithubWithFallback(
              `/repos/${ORG}/${repo}/actions/artifacts?per_page=100`,
              { artifacts: [] },
              ["coverage", "playwright"],
              "Falha ao consultar artifacts do GitHub. Cobertura e Playwright podem aparecer como indisponíveis.",
            ),
          ]);

          const artifacts = artifactsData?.artifacts || [];
          const playwrightArtifact = pickNewestArtifact(artifacts, PLAYWRIGHT_ARTIFACT_NAME_HINTS);
          const coverageArtifact = pickNewestArtifact(artifacts, COVERAGE_ARTIFACT_NAME_HINTS);

          const [playwrightReport, coverageReport] = await Promise.all([
            fetchJsonFromArtifact(playwrightArtifact, ghToken, PLAYWRIGHT_JSON_FILE_HINTS, looksLikePlaywrightReport).catch(() => null),
            fetchJsonFromArtifact(coverageArtifact, ghToken, COVERAGE_JSON_FILE_HINTS, looksLikeCoverageSummary).catch(() => null),
          ]);

          const completedRuns = (runs.workflow_runs || [])
            .filter(run => run.status === "completed")
            .slice(0, 10);

          const playwrightRunReports = await Promise.all(completedRuns.map(async (run) => {
            const runArtifactsData = await fetchGithubWithFallback(
              `/repos/${ORG}/${repo}/actions/runs/${run.id}/artifacts?per_page=100`,
              { artifacts: [] },
              "playwright",
              "Falha parcial ao carregar reports do Playwright por run. Alguns detalhes podem estar ausentes.",
            );
            const runArtifact = pickNewestArtifact(runArtifactsData?.artifacts || [], PLAYWRIGHT_ARTIFACT_NAME_HINTS);
            const report = await fetchJsonFromArtifact(runArtifact, ghToken, PLAYWRIGHT_JSON_FILE_HINTS, looksLikePlaywrightReport).catch(() => null);
            const tests = extractPlaywrightTestCases(report);

            return {
              runId: run.id,
              runName: run.name || null,
              runUrl: run.html_url || null,
              createdAt: run.created_at || null,
              conclusion: run.conclusion || run.status || null,
              artifactName: runArtifact?.name || null,
              report,
              tests,
            };
          }));

          const performance = repo === "futuru-k6"
            ? await fetchK6PerformanceHistory(repo, ghToken, runs.workflow_runs || []).catch(() => {
              setSectionError("k6", "Falha ao carregar histórico de performance do futuru-k6.");
              return null;
            })
            : null;

          const latestParsedRunReport = playwrightRunReports.find(item => item.report) || null;
          const resolvedPlaywrightReport = playwrightReport || latestParsedRunReport?.report || null;
          const stats = resolvedPlaywrightReport?.stats || {};
          const coverageTotal = coverageReport?.total || {};
          const linesPct = Number(coverageTotal?.lines?.pct);
          const statementsPct = Number(coverageTotal?.statements?.pct);
          const coveragePct = Number.isFinite(linesPct)
            ? linesPct
            : (Number.isFinite(statementsPct) ? statementsPct : null);
          const unstableTests = aggregateFlakyTests(playwrightRunReports, { limit: 10 });

          const quality = {
            playwright: {
              expected: Number(stats.expected) || 0,
              unexpected: Number(stats.unexpected) || 0,
              flaky: Number(stats.flaky) || 0,
              skipped: Number(stats.skipped) || 0,
              durationMs: Number(stats.duration) || 0,
              artifactName: playwrightArtifact?.name || latestParsedRunReport?.artifactName || null,
              runUrl: playwrightArtifact?.workflow_run?.html_url
                || latestParsedRunReport?.runUrl
                || (playwrightArtifact?.workflow_run?.id
                  ? `https://github.com/${ORG}/${repo}/actions/runs/${playwrightArtifact.workflow_run.id}`
                  : null),
            },
            coverage: {
              pct: coveragePct,
              linesPct: Number.isFinite(linesPct) ? linesPct : null,
              branchesPct: Number(coverageTotal?.branches?.pct) || null,
              functionsPct: Number(coverageTotal?.functions?.pct) || null,
              statementsPct: Number.isFinite(statementsPct) ? statementsPct : null,
              artifactName: coverageArtifact?.name || null,
              runUrl: coverageArtifact?.workflow_run?.id
                ? `https://github.com/${ORG}/${repo}/actions/runs/${coverageArtifact.workflow_run.id}`
                : null,
            },
            unstableTests,
            playwrightRunReports,
            performance,
          };

          return {
            repo,
            repoInfo,
            runs: runs.workflow_runs || [],
            commits: Array.isArray(commits) ? commits : [],
            branches: Array.isArray(branches) ? branches : [],
            quality,
          };
        })),
        linearFetch(`{
          issues(filter: { team: { key: { eq: "${LINEAR_PROJECT}" } } }, first: 50, orderBy: updatedAt) {
            nodes {
              id identifier title state { name color type }
              priority assignee { name } labels { nodes { name color } }
              createdAt updatedAt url
            }
          }
        }`, linToken).catch(() => {
          setSectionError("linear", "Falha ao carregar dados do Linear. Seções de issues podem aparecer vazias.");
          return { data: { issues: { nodes: [] } } };
        }),
      ]);

      const linearIssues = linearData?.data?.issues?.nodes;
      if (!Array.isArray(linearIssues)) {
        setSectionError("linear", "Falha ao carregar dados do Linear. Seções de issues podem aparecer vazias.");
      }

      const issues = Array.isArray(linearIssues) ? linearIssues : [];
      const bugs = issues.filter(i => i.labels?.nodes?.some(l => l.name.toLowerCase().includes("bug")));
      const features = issues.filter(i => i.labels?.nodes?.some(l => ["feature", "feat", "enhancement"].some(k => l.name.toLowerCase().includes(k))));
      const inProgress = issues.filter(i => i.state?.type === "started");
      const done = issues.filter(i => i.state?.type === "completed");

      setData({ repos: reposData, issues, bugs, features, inProgress, done, sectionErrors });
      setConnected(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [ghToken, linToken]);

  const activeData = data?.repos?.find(r => r.repo === activeRepo);
  const k6Performance = data?.repos?.find(r => r.repo === "futuru-k6")?.performance || null;
  const unstableTests = activeData?.quality?.unstableTests || [];
  const sectionErrors = data?.sectionErrors || {};
  const allIssues = useMemo(() => data?.issues || [], [data?.issues]);

  const scopedIssues = useMemo(
    () => filterIssuesByScope(allIssues, issuesScope, QUALITY_DASHBOARD_LABEL),
    [allIssues, issuesScope],
  );

  const scopedBugs = scopedIssues.filter(i =>
    i.labels?.nodes?.some(l => String(l.name || "").toLowerCase().includes("bug")),
  );
  const scopedFeatures = scopedIssues.filter(i =>
    i.labels?.nodes?.some(l =>
      ["feature", "feat", "enhancement"].some(k => String(l.name || "").toLowerCase().includes(k)),
    ),
  );
  const scopedInProgress = scopedIssues.filter(i => i.state?.type === "started");

  if (!connected) {
    return (
      <>
        <style>{css}</style>
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          padding: isMobile ? 16 : 24,
          background: `radial-gradient(1200px 560px at 15% -10%, #123057 0%, transparent 65%), ${COLORS.bg}`,
        }}>
          <div style={{
            width: "100%",
            maxWidth: 560,
            animation: "fadeIn .5s ease",
            background: "rgba(15, 23, 42, 0.78)",
            border: `1px solid ${COLORS.border}`,
            borderRadius: isMobile ? 16 : 20,
            padding: isMobile ? "24px 18px" : "34px 32px",
            boxShadow: "0 18px 80px rgba(0, 0, 0, 0.35)",
          }}>
            <div style={{ marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10,
                  background: COLORS.accentDim, border: `0.5px solid ${COLORS.accentBorder}`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                }}>◈</div>
                <span style={{ fontSize: 12, ...mono, color: COLORS.accent, letterSpacing: "0.12em" }}>FUTURU QA</span>
              </div>
              <h1 style={{
                fontSize: isMobile ? 40 : 46,
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
                marginBottom: 10,
                color: COLORS.text,
                fontFamily: "'Sora', sans-serif",
              }}>
                Quality Dashboard
              </h1>
              <p style={{ fontSize: isMobile ? 16 : 17, color: COLORS.textMuted, lineHeight: 1.6, maxWidth: 500 }}>
                Conecte seus tokens para visualizar dados reais dos 4 repositórios e do Linear.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { label: "GitHub Personal Access Token", placeholder: "ghp_...", val: ghToken, set: setGhToken, hint: "Scope: repo (read)" },
                { label: "Linear API Key", placeholder: "lin_api_...", val: linToken, set: setLinToken, hint: "Settings → API → Personal Keys" },
              ].map(({ label, placeholder, val, set, hint }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ fontSize: 12, color: COLORS.textMuted, ...mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>
                  <input
                    type="password" value={val} onChange={e => set(e.target.value)}
                    placeholder={placeholder}
                    style={{
                      background: "rgba(17, 27, 46, 0.72)", border: `1px solid ${COLORS.border}`,
                      borderRadius: 10, padding: "14px 16px", color: COLORS.text,
                      fontSize: 15, outline: "none", width: "100%",
                      transition: "border-color .2s, box-shadow .2s",
                    }}
                    onFocus={e => {
                      e.target.style.borderColor = COLORS.accentBorder;
                      e.target.style.boxShadow = `0 0 0 3px ${COLORS.accentDim}`;
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = COLORS.border;
                      e.target.style.boxShadow = "none";
                    }}
                  />
                  <span style={{ fontSize: 12, color: COLORS.textDim }}>{hint}</span>
                </div>
              ))}

              {error && (
                <div style={{
                  background: COLORS.danger + "15", border: `0.5px solid ${COLORS.danger}40`,
                  borderRadius: 6, padding: "10px 14px", fontSize: 12, color: COLORS.danger, ...mono,
                }}>{error}</div>
              )}

              <button
                onClick={connect} disabled={loading || !ghToken || !linToken}
                style={{
                  background: loading ? COLORS.accentDim : COLORS.accent,
                  color: loading ? COLORS.accent : COLORS.bg,
                  border: "none", borderRadius: 10, padding: "15px 0",
                  fontSize: isMobile ? 17 : 16, fontWeight: 800, cursor: loading ? "wait" : "pointer",
                  fontFamily: "'Sora', sans-serif", letterSpacing: "0.01em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all .2s", opacity: !ghToken || !linToken ? 0.5 : 1,
                  boxShadow: "0 12px 36px rgba(29, 214, 165, 0.25)",
                }}
              >
                {loading ? <><Spinner /> Conectando...</> : "Conectar →"}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const allRuns = data.repos.flatMap(r => r.runs.map(run => ({ ...run, repoName: r.repo })));
  const runMetrics = summarizeRunsByScope(allRuns, activeRepo);
  const recentRuns = allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);
  const mobileRecentRuns = showAllMobileRuns ? recentRuns : recentRuns.slice(0, 4);
  const totalPassed = runMetrics.global.passed;
  const totalFailed = runMetrics.global.failed;
  const totalRuns = runMetrics.active.total;
  const passedRuns = runMetrics.active.passed;
  const coverageRows = REPOS.map(repo => ({
    repo,
    ...data.repos.find(r => r.repo === repo)?.quality?.coverage,
  }));
  const playwrightRows = REPOS.map(repo => ({
    repo,
    ...data.repos.find(r => r.repo === repo)?.quality?.playwright,
  }));
  const totalExpected = playwrightRows.reduce((sum, r) => sum + (r.expected || 0), 0);
  const totalUnexpected = playwrightRows.reduce((sum, r) => sum + (r.unexpected || 0), 0);
  const totalFlaky = playwrightRows.reduce((sum, r) => sum + (r.flaky || 0), 0);

  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const priorityLabel = (p) => ["", "Urgente", "Alta", "Média", "Baixa"][p] || "—";
  const priorityColor = (p) => [COLORS.textMuted, COLORS.danger, COLORS.warn, COLORS.info, COLORS.textMuted][p] || COLORS.textMuted;

  return (
    <>
      <style>{css}</style>
      <div style={{
        minHeight: "100vh",
        background: `radial-gradient(1200px 560px at 15% -10%, #123057 0%, transparent 65%), ${COLORS.bg}`,
        padding: "0 0 52px",
      }}>

        {/* Header */}
        <div style={{
          borderBottom: `1px solid ${COLORS.border}`,
          padding: `${isMobile ? 12 : 16}px ${pagePaddingX}px`,
          display: "flex",
          alignItems: "center",
          flexWrap: isMobile ? "wrap" : "nowrap",
          rowGap: 8,
          justifyContent: "space-between", position: "sticky", top: 0,
          background: COLORS.bg + "e8", backdropFilter: "blur(10px)", zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>◈</span>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.01em", fontFamily: "'Sora', sans-serif" }}>Futuru QA</span>
            <Tag>Dashboard</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.success, animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 11, color: COLORS.textMuted, ...mono }}>LIVE</span>
            <button onClick={() => {
              setConnected(false);
              setData(null);
              setError(null);
              setShowAllMobileRuns(false);
              setGhToken("");
              setLinToken("");
            }} style={{
              marginLeft: 12, background: COLORS.surface, border: `0.5px solid ${COLORS.borderHover}`,
              borderRadius: 5, padding: "4px 10px", color: "#b8c3d3", fontSize: 11,
              cursor: "pointer", ...mono,
            }}>desconectar</button>
          </div>
        </div>

        <div style={{
          padding: `${contentPaddingY}px ${pagePaddingX}px`,
          display: "flex",
          flexDirection: "column",
          gap: sectionGap,
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 12, color: COLORS.textMuted, ...mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Escopo de Issues
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setIssuesScope("quality")}
                style={{
                  background: issuesScope === "quality" ? COLORS.accentDim : "transparent",
                  border: `0.5px solid ${issuesScope === "quality" ? COLORS.accentBorder : COLORS.border}`,
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: issuesScope === "quality" ? COLORS.accent : COLORS.textMuted,
                  fontSize: 12,
                  cursor: "pointer",
                  ...mono,
                }}
              >
                Quality Dashboard
              </button>
              <button
                onClick={() => setIssuesScope("global")}
                style={{
                  background: issuesScope === "global" ? COLORS.accentDim : "transparent",
                  border: `0.5px solid ${issuesScope === "global" ? COLORS.accentBorder : COLORS.border}`,
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: issuesScope === "global" ? COLORS.accent : COLORS.textMuted,
                  fontSize: 12,
                  cursor: "pointer",
                  ...mono,
                }}
              >
                FTU Global
              </button>
            </div>
          </div>

          {/* Stats Row */}
          <div style={{ display: "grid", gridTemplateColumns: statsGridColumns, gap: 14 }}>
            <Stat label="Repos" value={REPOS.length} sub="monitorados" />
            <Stat label={`Issues (${issuesScope === "global" ? "FTU" : "QDB"})`} value={scopedIssues.length} color={COLORS.info} />
            <Stat label={`Em progresso (${issuesScope === "global" ? "FTU" : "QDB"})`} value={scopedInProgress.length} color={COLORS.warn} />
            <Stat label={`Bugs abertos (${issuesScope === "global" ? "FTU" : "QDB"})`} value={scopedBugs.filter(b => b.state?.type !== "completed").length} color={COLORS.danger} />
            <Stat label="Runs passou (global)" value={totalPassed} color={COLORS.success} />
            <Stat label="Runs falhou (global)" value={totalFailed} color={COLORS.danger} />
          </div>

          {sectionErrors.k6 && (
            <SectionErrorNotice message={sectionErrors.k6} onRetry={connect} disabled={loading} />
          )}
          <K6PerformanceSection performance={k6Performance} />

          {/* Pipeline + Commits */}
          <div style={{ display: "grid", gridTemplateColumns: dualGridColumns, gap: 20 }}>

            {/* Pipeline Status */}
            <Card>
              <SectionHeader icon="⬡" title="Status dos Pipelines" tag="GitHub Actions" />
              {sectionErrors.github && (
                <SectionErrorNotice message={sectionErrors.github} onRetry={connect} disabled={loading} />
              )}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {REPOS.map(r => (
                  <button key={r} onClick={() => setActiveRepo(r)} style={{
                    background: activeRepo === r ? COLORS.accentDim : "transparent",
                    border: `0.5px solid ${activeRepo === r ? COLORS.accentBorder : COLORS.border}`,
                    borderRadius: 5, padding: "4px 10px", color: activeRepo === r ? COLORS.accent : COLORS.textMuted,
                    fontSize: 11, cursor: "pointer", ...mono, transition: "all .15s",
                  }}>{r.replace("futuru-", "")}</button>
                ))}
              </div>
              {activeData?.runs?.length === 0
                ? <EmptyState message="Nenhum workflow encontrado" />
                : activeData?.runs?.slice(0, 6).map(run => (
                  <div key={run.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                    borderBottom: `0.5px solid ${COLORS.border}`,
                  }}>
                    <StatusDot status={run.conclusion || run.status} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.name}</div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted, ...mono }}>{run.head_branch} · {fmt(run.created_at)}</div>
                    </div>
                    <Tag color={run.conclusion === "success" ? COLORS.success : run.conclusion === "failure" ? COLORS.danger : COLORS.warn}>
                      {run.conclusion || run.status}
                    </Tag>
                  </div>
                ))}
              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <div style={{ flex: 1, background: COLORS.bg, borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontSize: 10, color: COLORS.textMuted, ...mono, marginBottom: 4 }}>TAXA DE SUCESSO (REPO ATIVO)</div>
                  <div style={{ height: 4, background: COLORS.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${totalRuns ? Math.round(passedRuns / totalRuns * 100) : 0}%`, background: COLORS.success, borderRadius: 2, transition: "width .6s ease" }} />
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.textMuted, ...mono, marginTop: 4 }}>
                    {activeRepo.replace("futuru-", "")}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.success, marginTop: 4 }}>
                    {runMetrics.active.ratePct}%
                  </div>
                </div>
              </div>
            </Card>

            {/* Últimos Commits / Deploy */}
            <Card>
              <SectionHeader icon="↑" title="Último Deploy / Commits" tag="GitHub" />
              {sectionErrors.github && (
                <SectionErrorNotice message={sectionErrors.github} onRetry={connect} disabled={loading} />
              )}
              {REPOS.map(r => {
                const rd = data.repos.find(x => x.repo === r);
                const commit = rd?.commits?.[0];
                return (
                  <div key={r} style={{
                    padding: "10px 0", borderBottom: `0.5px solid ${COLORS.border}`,
                    display: "flex", flexDirection: "column", gap: 4,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, ...mono, color: COLORS.accent }}>{r.replace("futuru-", "")}</span>
                      {commit && <span style={{ fontSize: 10, ...mono, color: COLORS.textMuted }}>{fmt(commit.commit?.author?.date)}</span>}
                    </div>
                    {commit
                      ? <>
                        <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>
                          {commit.commit?.message?.split("\n")[0]?.slice(0, 60)}{commit.commit?.message?.length > 60 ? "..." : ""}
                        </div>
                        <div style={{ fontSize: 11, color: COLORS.textMuted }}>por {commit.commit?.author?.name}</div>
                      </>
                      : <div style={{ fontSize: 12, color: COLORS.textMuted }}>Sem commits encontrados</div>
                    }
                  </div>
                );
              })}
            </Card>
          </div>

          {/* Test Runs */}
          <Card>
            <SectionHeader icon="▷" title="Test Runs — Todas as Execuções" tag={`${recentRuns.length} recentes`} />
            {sectionErrors.github && (
              <SectionErrorNotice message={sectionErrors.github} onRetry={connect} disabled={loading} />
            )}
            {recentRuns.length === 0
              ? <EmptyState message="Nenhuma execução encontrada" />
              : isMobile
                ? <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {mobileRecentRuns.map(run => {
                    const dur = run.updated_at && run.created_at
                      ? Math.round((new Date(run.updated_at) - new Date(run.created_at)) / 1000)
                      : null;
                    return (
                      <div key={run.id} style={{
                        border: `0.5px solid ${COLORS.border}`,
                        borderRadius: 8,
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        background: COLORS.bg,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <StatusDot status={run.conclusion || run.status} />
                            <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, minWidth: 0 }}>
                              {run.name}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Tag color={COLORS.accent}>{run.repoName?.replace("futuru-", "")}</Tag>
                            <Tag color={run.conclusion === "success" ? COLORS.success : run.conclusion === "failure" ? COLORS.danger : COLORS.warn}>
                              {run.conclusion || run.status || "—"}
                            </Tag>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: COLORS.textMuted, ...mono, textTransform: "uppercase" }}>Branch</div>
                            <div style={{ fontSize: 11, color: COLORS.text, ...mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {run.head_branch || "—"}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: COLORS.textMuted, ...mono, textTransform: "uppercase" }}>Duração</div>
                            <div style={{ fontSize: 11, color: COLORS.text, ...mono }}>{dur ? `${dur}s` : "—"}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: COLORS.textMuted, ...mono }}>
                          Iniciado: {fmt(run.created_at)}
                        </div>
                      </div>
                    );
                  })}
                  {recentRuns.length > 4 && (
                    <button
                      onClick={() => setShowAllMobileRuns(value => !value)}
                      style={{
                        marginTop: 2,
                        background: "transparent",
                        border: `0.5px solid ${COLORS.borderHover}`,
                        borderRadius: 6,
                        padding: "8px 10px",
                        color: COLORS.textMuted,
                        fontSize: 11,
                        cursor: "pointer",
                        ...mono,
                      }}
                    >
                      {showAllMobileRuns ? "mostrar menos" : `ver mais (+${recentRuns.length - 4})`}
                    </button>
                  )}
                </div>
                : <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `0.5px solid ${COLORS.border}` }}>
                        {["Status", "Workflow", "Repo", "Branch", "Iniciado", "Duração"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: COLORS.textMuted, ...mono, fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recentRuns.map(run => {
                        const dur = run.updated_at && run.created_at
                          ? Math.round((new Date(run.updated_at) - new Date(run.created_at)) / 1000)
                          : null;
                        return (
                          <tr key={run.id} style={{ borderBottom: `0.5px solid ${COLORS.border}`, transition: "background .1s" }}
                            onMouseEnter={e => e.currentTarget.style.background = COLORS.surface}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <td style={{ padding: "8px 10px" }}><StatusDot status={run.conclusion || run.status} /></td>
                            <td style={{ padding: "8px 10px", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.name}</td>
                            <td style={{ padding: "8px 10px" }}><Tag color={COLORS.accent}>{run.repoName?.replace("futuru-", "")}</Tag></td>
                            <td style={{ padding: "8px 10px", ...mono, color: COLORS.textMuted, fontSize: 11 }}>{run.head_branch}</td>
                            <td style={{ padding: "8px 10px", ...mono, color: COLORS.textMuted, fontSize: 11 }}>{fmt(run.created_at)}</td>
                            <td style={{ padding: "8px 10px", ...mono, fontSize: 11 }}>{dur ? `${dur}s` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
            }
          </Card>

          {/* Coverage + Playwright Summary */}
          <div style={{ display: "grid", gridTemplateColumns: dualGridColumns, gap: 20 }}>
            <Card>
              <SectionHeader icon="◔" title="Cobertura de Código" tag="GitHub Artifacts" />
              {sectionErrors.coverage && (
                <SectionErrorNotice message={sectionErrors.coverage} onRetry={connect} disabled={loading} />
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {coverageRows.map(row => {
                  const threshold = COVERAGE_THRESHOLDS[row.repo] || 70;
                  const hasPct = typeof row.pct === "number";
                  const ok = hasPct && row.pct >= threshold;
                  const pctColor = !hasPct ? COLORS.textMuted : ok ? COLORS.success : COLORS.danger;
                  return (
                    <div key={row.repo} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderBottom: `0.5px solid ${COLORS.border}`, padding: "8px 0",
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 11, ...mono, color: COLORS.accent }}>{row.repo.replace("futuru-", "")}</span>
                        <span style={{ fontSize: 11, color: COLORS.textMuted }}>
                          {row.artifactName
                            ? `threshold ${threshold}%`
                            : "sem artifact coverage-summary"}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {row.runUrl && <a href={row.runUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: COLORS.info, ...mono }}>run</a>}
                        <span style={{ fontSize: 18, fontWeight: 800, color: pctColor }}>
                          {hasPct ? `${Math.round(row.pct)}%` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <SectionHeader icon="◎" title="Playwright Summary" tag="results.json" />
              {sectionErrors.playwright && (
                <SectionErrorNotice message={sectionErrors.playwright} onRetry={connect} disabled={loading} />
              )}
              <div style={{ display: "grid", gridTemplateColumns: triGridColumns, gap: 10, marginBottom: 12 }}>
                <Stat label="Passed" value={totalExpected} color={COLORS.success} />
                <Stat label="Failed" value={totalUnexpected} color={COLORS.danger} />
                <Stat label="Flaky" value={totalFlaky} color={COLORS.warn} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {playwrightRows.map(row => {
                  const hasArtifact = !!row.artifactName;
                  return (
                    <div key={row.repo} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderBottom: `0.5px solid ${COLORS.border}`, padding: "8px 0",
                    }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 11, ...mono, color: COLORS.accent }}>{row.repo.replace("futuru-", "")}</span>
                        <span style={{ fontSize: 11, color: COLORS.textMuted }}>
                          {hasArtifact ? `P:${row.expected || 0} F:${row.unexpected || 0} Fl:${row.flaky || 0}` : "sem artifact results.json"}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {row.runUrl && <a href={row.runUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: COLORS.info, ...mono }}>run</a>}
                        <Tag color={hasArtifact ? COLORS.success : COLORS.textMuted}>{hasArtifact ? "ok" : "n/a"}</Tag>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Testes Instáveis */}
          <Card>
            <SectionHeader icon="!" title="Testes instáveis" />
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 14,
            }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted, lineHeight: 1.5 }}>
                {"Critério: falhou >= 2 e passou >= 1 nas últimas 10 execuções do Playwright para o repositório ativo."}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Tag color={unstableTests.length > 0 ? COLORS.warn : COLORS.textMuted}>{`${unstableTests.length} casos`}</Tag>
                <Tag color={COLORS.info}>{activeRepo.replace("futuru-", "")}</Tag>
              </div>
            </div>
            {unstableTests.length === 0
              ? <EmptyState message={`Nenhum teste instável encontrado nos últimos 10 runs de ${activeRepo.replace("futuru-", "")}`} />
              : isMobile
                ? <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {unstableTests.map(test => (
                    <div key={test.key} style={{
                      border: `0.5px solid ${COLORS.border}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      background: COLORS.bg,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, minWidth: 0 }}>
                          {test.name}
                        </div>
                        <Tag color={test.failures >= 3 ? COLORS.danger : COLORS.warn}>
                          {test.failures} falhas
                        </Tag>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontSize: 11, color: COLORS.textMuted, ...mono }}>
                          Última falha: {fmt(test.lastFailureAt)}
                        </span>
                        {test.lastFailureRunUrl
                          ? <a href={test.lastFailureRunUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.info, ...mono, fontSize: 11 }}>
                            abrir run
                          </a>
                          : <span style={{ color: COLORS.textMuted, ...mono, fontSize: 11 }}>sem link</span>}
                      </div>
                    </div>
                  ))}
                </div>
                : <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `0.5px solid ${COLORS.border}` }}>
                        {["Teste", "Falhas (10)", "Última falha", "Run"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: COLORS.textMuted, ...mono, fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {unstableTests.map(test => (
                        <tr key={test.key} style={{ borderBottom: `0.5px solid ${COLORS.border}` }}>
                          <td style={{ padding: "9px 10px", maxWidth: 320 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {test.name}
                            </div>
                          </td>
                          <td style={{ padding: "9px 10px" }}>
                            <Tag color={test.failures >= 3 ? COLORS.danger : COLORS.warn}>
                              {test.failures} falhas
                            </Tag>
                          </td>
                          <td style={{ padding: "9px 10px", ...mono, color: COLORS.textMuted, fontSize: 11 }}>
                            {fmt(test.lastFailureAt)}
                          </td>
                          <td style={{ padding: "9px 10px" }}>
                            {test.lastFailureRunUrl
                              ? <a href={test.lastFailureRunUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.info, ...mono, fontSize: 11 }}>
                                abrir run
                              </a>
                              : <span style={{ color: COLORS.textMuted, ...mono, fontSize: 11 }}>sem link</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </Card>

          {/* Bugs + Features */}
          {sectionErrors.linear && (
            <SectionErrorNotice message={sectionErrors.linear} onRetry={connect} disabled={loading} />
          )}
          <div style={{ display: "grid", gridTemplateColumns: dualGridColumns, gap: 20 }}>

            <Card>
              <SectionHeader icon="⚠" title="Bugs" tag={`${scopedBugs.length} encontrados`} />
              {scopedBugs.length === 0
                ? <EmptyState message="Nenhum bug com label 'bug' encontrado no Linear" />
                : scopedBugs.slice(0, 8).map(issue => (
                  <div key={issue.id} style={{ padding: "9px 0", borderBottom: `0.5px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, ...mono, color: COLORS.textMuted }}>{issue.identifier}</span>
                        <Tag color={priorityColor(issue.priority)}>{priorityLabel(issue.priority)}</Tag>
                      </div>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: issue.state?.color || COLORS.textMuted, flexShrink: 0 }} />
                    </div>
                    <a href={issue.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 500, color: COLORS.text, textDecoration: "none", lineHeight: 1.4 }}>
                      {issue.title?.slice(0, 70)}{issue.title?.length > 70 ? "..." : ""}
                    </a>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: COLORS.textMuted }}>{issue.state?.name}</span>
                      {issue.assignee && <><span style={{ color: COLORS.textDim }}>·</span><span style={{ fontSize: 11, color: COLORS.textMuted }}>{issue.assignee.name}</span></>}
                    </div>
                  </div>
                ))}
            </Card>

            <Card>
              <SectionHeader icon="◇" title="Features Testadas" tag={`${scopedFeatures.length} mapeadas`} />
              {scopedFeatures.length === 0
                ? <EmptyState message="Nenhuma feature com label 'feature/feat' no Linear" />
                : scopedFeatures.slice(0, 8).map(issue => (
                  <div key={issue.id} style={{ padding: "9px 0", borderBottom: `0.5px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, ...mono, color: COLORS.textMuted }}>{issue.identifier}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: issue.state?.color || COLORS.textMuted }} />
                        <span style={{ fontSize: 11, color: COLORS.textMuted }}>{issue.state?.name}</span>
                      </div>
                    </div>
                    <a href={issue.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 500, color: COLORS.text, textDecoration: "none", lineHeight: 1.4 }}>
                      {issue.title?.slice(0, 70)}{issue.title?.length > 70 ? "..." : ""}
                    </a>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {issue.labels?.nodes?.map(l => (
                        <Tag key={l.name} color={l.color || COLORS.info}>{l.name}</Tag>
                      ))}
                    </div>
                  </div>
                ))}
            </Card>
          </div>

          {/* Issues em progresso */}
          <Card>
            <SectionHeader icon="→" title="Em Progresso" tag={`${scopedInProgress.length} issues`} />
            {scopedInProgress.length === 0
              ? <EmptyState message="Nenhuma issue em progresso no Linear" />
              : <div style={{ display: "grid", gridTemplateColumns: triGridColumns, gap: 12 }}>
                {scopedInProgress.map(issue => (
                  <a key={issue.id} href={issue.url} target="_blank" rel="noreferrer" style={{
                    textDecoration: "none", background: COLORS.bg,
                    border: `0.5px solid ${COLORS.border}`, borderRadius: 8, padding: "12px 14px",
                    display: "flex", flexDirection: "column", gap: 6, transition: "border-color .15s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.borderHover}
                    onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.border}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, ...mono, color: COLORS.accent }}>{issue.identifier}</span>
                      <Tag color={priorityColor(issue.priority)}>{priorityLabel(issue.priority)}</Tag>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.text, lineHeight: 1.4 }}>
                      {issue.title?.slice(0, 60)}{issue.title?.length > 60 ? "..." : ""}
                    </span>
                    {issue.assignee && <span style={{ fontSize: 11, color: COLORS.textMuted }}>{issue.assignee.name}</span>}
                  </a>
                ))}
              </div>
            }
          </Card>

        </div>
      </div>
    </>
  );
}
