const DEFAULT_SCOPE_LABEL = "quality dashboard";

export function filterIssuesByScope(issues, scope, scopeLabel = DEFAULT_SCOPE_LABEL) {
  const safeIssues = Array.isArray(issues) ? issues : [];
  if (scope === "global") return safeIssues;

  const normalizedLabel = String(scopeLabel || "").trim().toLowerCase();
  if (!normalizedLabel) return safeIssues;

  return safeIssues.filter(issue =>
    issue?.labels?.nodes?.some(label =>
      String(label?.name || "").toLowerCase().includes(normalizedLabel),
    ),
  );
}

export function summarizeRunsByScope(allRuns, activeRepo) {
  const safeRuns = Array.isArray(allRuns) ? allRuns : [];
  const activeRuns = safeRuns.filter(run => run?.repoName === activeRepo);
  const activePassed = activeRuns.filter(run => run?.conclusion === "success").length;
  const activeTotal = activeRuns.length;

  return {
    global: {
      passed: safeRuns.filter(run => run?.conclusion === "success").length,
      failed: safeRuns.filter(run => run?.conclusion === "failure").length,
      total: safeRuns.length,
    },
    active: {
      passed: activePassed,
      total: activeTotal,
      ratePct: activeTotal > 0 ? Math.round((activePassed / activeTotal) * 100) : 0,
    },
  };
}

