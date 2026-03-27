import { useState, useCallback, useEffect } from "react";
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
import K6PerformanceSection from "./components/K6PerformanceSection.jsx";

const REPOS = [
  "futuru-frontend",
  "futuru-k6",
  "futuru-core",
  "futuru-bff",
];
const ORG = "Futuru-prediction";
const LINEAR_PROJECT = "FTU";
const COVERAGE_THRESHOLDS = {
  "futuru-frontend": 70,
  "futuru-core": 80,
  "futuru-bff": 70,
  "futuru-k6": 70,
};

const COLORS = {
  bg: "#0a0c0f",
  surface: "#111418",
  border: "#1e2329",
  borderHover: "#2d3440",
  accent: "#00e5a0",
  accentDim: "#00e5a020",
  accentBorder: "#00e5a040",
  warn: "#f5a623",
  danger: "#e05252",
  info: "#4a9eff",
  text: "#e8eaed",
  textMuted: "#6b7280",
  textDim: "#3d4451",
  success: "#22c55e",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Syne:wght@400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${COLORS.bg}; color: ${COLORS.text}; font-family: 'Syne', sans-serif; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 2px; }
  input { font-family: 'JetBrains Mono', monospace; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin { to{transform:rotate(360deg)} }
  @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(400%)} }
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

function Tag({ color = COLORS.accent, children }) {
  return (
    <span style={{
      ...mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
      padding: "2px 7px", borderRadius: 3,
      background: color + "20", color, border: `0.5px solid ${color}40`,
      textTransform: "uppercase",
    }}>{children}</span>
  );
}

function Stat({ label, value, sub, color = COLORS.accent, loading }) {
  return (
    <div style={{
      background: COLORS.surface, border: `0.5px solid ${COLORS.border}`,
      borderRadius: 8, padding: "16px 18px", display: "flex",
      flexDirection: "column", gap: 6, animation: "fadeIn .4s ease",
    }}>
      <span style={{ fontSize: 11, color: COLORS.textMuted, ...mono, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
      {loading
        ? <div style={{ height: 28, background: COLORS.border, borderRadius: 4, animation: "pulse 1.4s infinite" }} />
        : <span style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value ?? "—"}</span>
      }
      {sub && <span style={{ fontSize: 11, color: COLORS.textMuted }}>{sub}</span>}
    </div>
  );
}

function SectionHeader({ icon, title, tag }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>{title}</span>
      {tag && <Tag>{tag}</Tag>}
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: COLORS.surface, border: `0.5px solid ${COLORS.border}`,
      borderRadius: 10, padding: "20px 22px", animation: "fadeIn .35s ease",
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
    <div style={{ textAlign: "center", padding: "32px 0", color: COLORS.textMuted, fontSize: 13 }}>
      {message}
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

    return {
      runId: run.id,
      runName: run.name || null,
      runUrl: run.html_url || null,
      createdAt: run.created_at || null,
      conclusion: run.conclusion || run.status || null,
      artifactName: summaryArtifact?.name || null,
      metrics: parsed?.metrics || null,
      thresholds: parsed?.thresholds || null,
    };
  }));

  const validRuns = runs.filter(run => run.metrics && (
    run.metrics.p95Ms !== null
    || run.metrics.p99Ms !== null
    || run.metrics.errorRatePct !== null
    || run.metrics.rps !== null
  ));

  return buildK6TrendSeries(validRuns, { limit: 10 });
}

export default function App() {
  const viewportWidth = useViewportWidth();
  const isMobile = viewportWidth <= 640;
  const isTablet = viewportWidth <= 980;
  const pagePaddingX = isMobile ? 14 : isTablet ? 20 : 32;
  const contentPaddingY = isMobile ? 18 : 28;
  const sectionGap = isMobile ? 18 : 28;
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

  const connect = useCallback(async () => {
    if (!ghToken.trim() || !linToken.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const [reposData, linearData] = await Promise.all([
        Promise.all(REPOS.map(async (repo) => {
          const [repoInfo, runs, commits, branches, artifactsData] = await Promise.all([
            ghFetch(`/repos/${ORG}/${repo}`, ghToken).catch(() => null),
            ghFetch(`/repos/${ORG}/${repo}/actions/runs?per_page=15`, ghToken).catch(() => ({ workflow_runs: [] })),
            ghFetch(`/repos/${ORG}/${repo}/commits?per_page=5`, ghToken).catch(() => []),
            ghFetch(`/repos/${ORG}/${repo}/branches`, ghToken).catch(() => []),
            ghFetch(`/repos/${ORG}/${repo}/actions/artifacts?per_page=100`, ghToken).catch(() => ({ artifacts: [] })),
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
            const runArtifactsData = await ghFetch(`/repos/${ORG}/${repo}/actions/runs/${run.id}/artifacts?per_page=100`, ghToken)
              .catch(() => ({ artifacts: [] }));
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
            ? await fetchK6PerformanceHistory(repo, ghToken, runs.workflow_runs || []).catch(() => null)
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
        }`, linToken).catch(() => ({ data: { issues: { nodes: [] } } })),
      ]);

      const issues = linearData?.data?.issues?.nodes || [];
      const bugs = issues.filter(i => i.labels?.nodes?.some(l => l.name.toLowerCase().includes("bug")));
      const features = issues.filter(i => i.labels?.nodes?.some(l => ["feature", "feat", "enhancement"].some(k => l.name.toLowerCase().includes(k))));
      const inProgress = issues.filter(i => i.state?.type === "started");
      const done = issues.filter(i => i.state?.type === "completed");

      setData({ repos: reposData, issues, bugs, features, inProgress, done });
      setConnected(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [ghToken, linToken]);

  const activeData = data?.repos?.find(r => r.repo === activeRepo);
  const k6Performance = data?.repos?.find(r => r.repo === "futuru-k6")?.performance || null;
  const passedRuns = activeData?.runs?.filter(r => r.conclusion === "success").length || 0;
  const totalRuns = activeData?.runs?.length || 0;
  const unstableTests = activeData?.quality?.unstableTests || [];

  if (!connected) {
    return (
      <>
        <style>{css}</style>
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24, background: COLORS.bg,
        }}>
          <div style={{ width: "100%", maxWidth: 420, animation: "fadeIn .5s ease" }}>
            <div style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: COLORS.accentDim, border: `0.5px solid ${COLORS.accentBorder}`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                }}>◈</div>
                <span style={{ fontSize: 13, ...mono, color: COLORS.accent, letterSpacing: "0.1em" }}>FUTURU QA</span>
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.03em", marginBottom: 8 }}>
                Quality Dashboard
              </h1>
              <p style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.6 }}>
                Conecte seus tokens para visualizar dados reais dos 4 repositórios e do Linear.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { label: "GitHub Personal Access Token", placeholder: "ghp_...", val: ghToken, set: setGhToken, hint: "Scope: repo (read)" },
                { label: "Linear API Key", placeholder: "lin_api_...", val: linToken, set: setLinToken, hint: "Settings → API → Personal Keys" },
              ].map(({ label, placeholder, val, set, hint }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 11, color: COLORS.textMuted, ...mono, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</label>
                  <input
                    type="password" value={val} onChange={e => set(e.target.value)}
                    placeholder={placeholder}
                    style={{
                      background: COLORS.surface, border: `0.5px solid ${COLORS.border}`,
                      borderRadius: 6, padding: "10px 14px", color: COLORS.text,
                      fontSize: 13, outline: "none", width: "100%",
                      transition: "border-color .2s",
                    }}
                    onFocus={e => e.target.style.borderColor = COLORS.accentBorder}
                    onBlur={e => e.target.style.borderColor = COLORS.border}
                  />
                  <span style={{ fontSize: 11, color: COLORS.textDim }}>{hint}</span>
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
                  border: "none", borderRadius: 6, padding: "11px 0",
                  fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer",
                  fontFamily: "'Syne', sans-serif", letterSpacing: "0.02em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all .2s", opacity: !ghToken || !linToken ? 0.5 : 1,
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
  const recentRuns = allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);
  const totalPassed = allRuns.filter(r => r.conclusion === "success").length;
  const totalFailed = allRuns.filter(r => r.conclusion === "failure").length;
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
      <div style={{ minHeight: "100vh", background: COLORS.bg, padding: "0 0 48px" }}>

        {/* Header */}
        <div style={{
          borderBottom: `0.5px solid ${COLORS.border}`,
          padding: `${isMobile ? 12 : 16}px ${pagePaddingX}px`,
          display: "flex",
          alignItems: "center",
          flexWrap: isMobile ? "wrap" : "nowrap",
          rowGap: 8,
          justifyContent: "space-between", position: "sticky", top: 0,
          background: COLORS.bg + "ee", backdropFilter: "blur(8px)", zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 18 }}>◈</span>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em" }}>Futuru QA</span>
            <Tag>Dashboard</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.success, animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 11, color: COLORS.textMuted, ...mono }}>LIVE</span>
            <button onClick={() => {
              setConnected(false);
              setData(null);
              setError(null);
              setGhToken("");
              setLinToken("");
            }} style={{
              marginLeft: 12, background: "transparent", border: `0.5px solid ${COLORS.border}`,
              borderRadius: 5, padding: "4px 10px", color: COLORS.textMuted, fontSize: 11,
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

          {/* Stats Row */}
          <div style={{ display: "grid", gridTemplateColumns: statsGridColumns, gap: 12 }}>
            <Stat label="Repos" value={REPOS.length} sub="monitorados" />
            <Stat label="Issues Total" value={data.issues.length} color={COLORS.info} />
            <Stat label="Em progresso" value={data.inProgress.length} color={COLORS.warn} />
            <Stat label="Bugs abertos" value={data.bugs.filter(b => b.state?.type !== "completed").length} color={COLORS.danger} />
            <Stat label="Runs passou" value={totalPassed} color={COLORS.success} />
            <Stat label="Runs falhou" value={totalFailed} color={COLORS.danger} />
          </div>

          <K6PerformanceSection performance={k6Performance} />

          {/* Pipeline + Commits */}
          <div style={{ display: "grid", gridTemplateColumns: dualGridColumns, gap: 20 }}>

            {/* Pipeline Status */}
            <Card>
              <SectionHeader icon="⬡" title="Status dos Pipelines" tag="GitHub Actions" />
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
                  <div style={{ fontSize: 10, color: COLORS.textMuted, ...mono, marginBottom: 4 }}>TAXA DE SUCESSO</div>
                  <div style={{ height: 4, background: COLORS.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${totalRuns ? Math.round(passedRuns / totalRuns * 100) : 0}%`, background: COLORS.success, borderRadius: 2, transition: "width .6s ease" }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.success, marginTop: 4 }}>
                    {totalRuns ? Math.round(passedRuns / totalRuns * 100) : 0}%
                  </div>
                </div>
              </div>
            </Card>

            {/* Últimos Commits / Deploy */}
            <Card>
              <SectionHeader icon="↑" title="Último Deploy / Commits" tag="GitHub" />
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
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `0.5px solid ${COLORS.border}` }}>
                    {["Status", "Workflow", "Repo", "Branch", "Iniciado", "Duração"].map(h => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: COLORS.textMuted, ...mono, fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.length === 0
                    ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: COLORS.textMuted }}>Nenhuma execução encontrada</td></tr>
                    : recentRuns.map(run => {
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
          </Card>

          {/* Coverage + Playwright Summary */}
          <div style={{ display: "grid", gridTemplateColumns: dualGridColumns, gap: 20 }}>
            <Card>
              <SectionHeader icon="◔" title="Cobertura de Código" tag="GitHub Artifacts" />
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
          <div style={{ display: "grid", gridTemplateColumns: dualGridColumns, gap: 20 }}>

            <Card>
              <SectionHeader icon="⚠" title="Bugs" tag={`${data.bugs.length} encontrados`} />
              {data.bugs.length === 0
                ? <EmptyState message="Nenhum bug com label 'bug' encontrado no Linear" />
                : data.bugs.slice(0, 8).map(issue => (
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
              <SectionHeader icon="◇" title="Features Testadas" tag={`${data.features.length} mapeadas`} />
              {data.features.length === 0
                ? <EmptyState message="Nenhuma feature com label 'feature/feat' no Linear" />
                : data.features.slice(0, 8).map(issue => (
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
            <SectionHeader icon="→" title="Em Progresso" tag={`${data.inProgress.length} issues`} />
            {data.inProgress.length === 0
              ? <EmptyState message="Nenhuma issue em progresso no Linear" />
              : <div style={{ display: "grid", gridTemplateColumns: triGridColumns, gap: 12 }}>
                {data.inProgress.map(issue => (
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
