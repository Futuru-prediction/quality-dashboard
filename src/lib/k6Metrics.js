export const K6_ARTIFACT_NAME_HINTS = [
  "k6-summary",
  "k6-report",
  "k6-results",
  "k6-metrics",
  "k6",
  "summary",
  "results",
];

export const K6_JSON_FILE_HINTS = [
  "raw-data.json",
  "summary.json",
  "k6-summary.json",
  "k6-results.json",
  "results.json",
  "report.json",
];

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map(toNumber)
    .filter(value => value !== null)
    .sort((a, b) => a - b);

  if (!nums.length) return null;

  const middle = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[middle];

  return (nums[middle - 1] + nums[middle]) / 2;
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function unitScaleToMs(unit) {
  const normalized = normalizeText(unit);
  if (!normalized || normalized === "ms") return 1;
  if (normalized === "s" || normalized === "sec" || normalized === "secs" || normalized === "second" || normalized === "seconds") {
    return 1000;
  }
  if (normalized === "us" || normalized === "µs" || normalized === "microsecond" || normalized === "microseconds") {
    return 0.001;
  }
  if (normalized === "ns" || normalized === "nanosecond" || normalized === "nanoseconds") {
    return 0.000001;
  }
  return 1;
}

function convertDurationToMs(value, unit) {
  const number = toNumber(value);
  if (number === null) return null;
  return number * unitScaleToMs(unit);
}

function formatDateLabel(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function findMetric(metrics, metricName) {
  if (!isRecord(metrics)) return null;

  if (isRecord(metrics[metricName])) return metrics[metricName];

  const prefixMatch = Object.entries(metrics).find(([key]) => key === metricName || key.startsWith(`${metricName}{`));
  return prefixMatch?.[1] || null;
}

function getTrendValue(values, percentile) {
  if (!isRecord(values)) return null;

  const exact = toNumber(values[`p(${percentile})`]);
  if (exact !== null) return exact;

  const candidates = Object.entries(values)
    .map(([key, value]) => {
      const match = key.match(/^p\((\d+(?:\.\d+)?)\)$/);
      if (!match) return null;
      const percentileValue = Number(match[1]);
      const numericValue = toNumber(value);
      if (!Number.isFinite(percentileValue) || numericValue === null) return null;
      return {
        percentile: percentileValue,
        value: numericValue,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const diffA = Math.abs(a.percentile - percentile);
      const diffB = Math.abs(b.percentile - percentile);
      if (diffA !== diffB) return diffA - diffB;
      return b.percentile - a.percentile;
    });

  return candidates[0]?.value ?? null;
}

function parseThresholdExpression(expression, { summaryTimeUnit = "ms" } = {}) {
  const compact = String(expression ?? "").replace(/\s+/g, "");
  if (!compact) return null;

  const percentileMatch = compact.match(/^p\((\d+(?:\.\d+)?)\)<([0-9]*\.?[0-9]+)([a-zA-Zµ%]*)$/);
  if (percentileMatch) {
    const percentile = Number(percentileMatch[1]);
    const rawValue = Number(percentileMatch[2]);
    const unit = percentileMatch[3] || summaryTimeUnit;
    return {
      kind: "duration",
      percentile,
      rawValue,
      unit,
      valueMs: convertDurationToMs(rawValue, unit),
      expression: compact,
    };
  }

  const rateMatch = compact.match(/^(?:rate|http_req_failed\.rate)<([0-9]*\.?[0-9]+)(%?)$/);
  if (rateMatch) {
    const rawValue = Number(rateMatch[1]);
    const unit = rateMatch[2] || "";
    return {
      kind: "rate",
      rawValue,
      unit,
      valuePct: unit === "%" ? rawValue : rawValue <= 1 ? rawValue * 100 : rawValue,
      expression: compact,
    };
  }

  return null;
}

function collectThresholds(metric, metricName, summaryTimeUnit, summaryThresholds = null) {
  const thresholdEntries = [];
  const metricThresholds = isRecord(metric?.thresholds) ? metric.thresholds : null;

  for (const [expression, meta] of Object.entries(metricThresholds || {})) {
    const parsed = parseThresholdExpression(expression, { summaryTimeUnit });
    if (parsed) {
      thresholdEntries.push({
        ...parsed,
        ok: typeof meta?.ok === "boolean" ? meta.ok : null,
        source: "metric",
      });
    }
  }

  if (Array.isArray(summaryThresholds?.[metricName])) {
    for (const expression of summaryThresholds[metricName]) {
      const parsed = parseThresholdExpression(expression, { summaryTimeUnit });
      if (parsed) {
        thresholdEntries.push({
          ...parsed,
          ok: null,
          source: "options",
        });
      }
    }
  }

  return thresholdEntries;
}

function pickDurationThreshold(thresholds, percentile) {
  return thresholds.find(threshold => threshold.kind === "duration" && threshold.percentile === percentile) || null;
}

function pickRateThreshold(thresholds) {
  return thresholds.find(threshold => threshold.kind === "rate") || null;
}

function scoreMetric(current, baseline, higherIsBetter) {
  if (current === null || current === undefined) return {
    tone: "muted",
    alert: "no data",
    deltaPct: null,
    isHealthy: null,
  };

  if (baseline === null || baseline === undefined || baseline === 0) {
    return {
      tone: "neutral",
      alert: null,
      deltaPct: null,
      isHealthy: null,
    };
  }

  const deltaPct = ((current - baseline) / baseline) * 100;
  const isHealthy = higherIsBetter ? current >= baseline : current <= baseline;
  const tone = isHealthy ? "good" : Math.abs(deltaPct) >= 10 ? "bad" : "warn";
  const alert = `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs baseline`;

  return {
    tone,
    alert,
    deltaPct,
    isHealthy,
  };
}

function scoreAgainstThreshold(current, threshold, higherIsBetter) {
  if (current === null || current === undefined || threshold === null || threshold === undefined) {
    return {
      tone: "neutral",
      alert: null,
      isHealthy: null,
    };
  }

  const isHealthy = higherIsBetter ? current >= threshold : current <= threshold;
  return {
    tone: isHealthy ? "good" : "bad",
    alert: isHealthy ? "within threshold" : "threshold breached",
    isHealthy,
  };
}

export function parseK6Summary(summary) {
  if (!isRecord(summary)) return null;

  const metricsRoot = isRecord(summary.metrics) ? summary.metrics : summary;
  const summaryTimeUnit = normalizeText(summary?.options?.summaryTimeUnit || "ms") || "ms";
  const durationMetric = findMetric(metricsRoot, "http_req_duration");
  const failedMetric = findMetric(metricsRoot, "http_req_failed");
  const requestsMetric = findMetric(metricsRoot, "http_reqs");

  const durationValues = isRecord(durationMetric?.values) ? durationMetric.values : null;
  const failedValues = isRecord(failedMetric?.values) ? failedMetric.values : null;
  const requestsValues = isRecord(requestsMetric?.values) ? requestsMetric.values : null;

  const p95Raw = getTrendValue(durationValues, 95);
  const p99Raw = getTrendValue(durationValues, 99);
  const p95Ms = convertDurationToMs(p95Raw, summaryTimeUnit);
  const p99Ms = convertDurationToMs(p99Raw, summaryTimeUnit);

  const failedRate = toNumber(failedValues?.rate ?? failedValues?.value);
  const errorRatePct = failedRate === null
    ? null
    : failedRate <= 1
      ? failedRate * 100
      : failedRate;

  const rps = toNumber(requestsValues?.rate ?? requestsValues?.value);

  const summaryThresholds = isRecord(summary?.options?.thresholds) ? summary.options.thresholds : null;
  const durationThresholds = collectThresholds(durationMetric, "http_req_duration", summaryTimeUnit, summaryThresholds);
  const failedThresholds = collectThresholds(failedMetric, "http_req_failed", summaryTimeUnit, summaryThresholds);
  const p95Threshold = pickDurationThreshold(durationThresholds, 95);
  const errorRateThreshold = pickRateThreshold(failedThresholds);

  const runDurationMs = toNumber(summary?.state?.testRunDurationMs);

  return {
    summaryTimeUnit,
    runDurationMs,
    metrics: {
      p95Ms,
      p99Ms,
      errorRatePct,
      rps,
    },
    thresholds: {
      p95Ms: p95Threshold?.valueMs ?? null,
      p95Ok: typeof p95Threshold?.ok === "boolean" ? p95Threshold.ok : null,
      errorRatePct: errorRateThreshold?.valuePct ?? null,
      errorRateOk: typeof errorRateThreshold?.ok === "boolean" ? errorRateThreshold.ok : null,
    },
    raw: summary,
  };
}

export function buildK6TrendSeries(runs, { limit = 10 } = {}) {
  const sortedRuns = (Array.isArray(runs) ? runs : [])
    .filter(run => run && run.createdAt)
    .map(run => ({
      ...run,
      createdAtMs: Date.parse(run.createdAt),
    }))
    .filter(run => Number.isFinite(run.createdAtMs))
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .slice(-limit)
    .map((run, index) => ({
      ...run,
      index,
      label: formatDateLabel(run.createdAt),
    }));

  const latestRun = sortedRuns.at(-1) || null;
  const previousRuns = latestRun ? sortedRuns.slice(0, -1) : [];

  const baseline = {
    p95Ms: median(previousRuns.map(run => run.metrics?.p95Ms)),
    p99Ms: median(previousRuns.map(run => run.metrics?.p99Ms)),
    errorRatePct: median(previousRuns.map(run => run.metrics?.errorRatePct)),
    rps: median(previousRuns.map(run => run.metrics?.rps)),
  };

  const threshold = {
    p95Ms: latestRun?.thresholds?.p95Ms
      ?? sortedRuns.find(run => run.thresholds?.p95Ms !== null && run.thresholds?.p95Ms !== undefined)?.thresholds?.p95Ms
      ?? null,
  };

  const cards = latestRun ? [
    {
      key: "p95",
      label: "P95 latency",
      value: latestRun.metrics?.p95Ms,
      baseline: baseline.p95Ms,
      thresholdMs: threshold.p95Ms,
      unit: "ms",
      higherIsBetter: false,
      tone: scoreAgainstThreshold(latestRun.metrics?.p95Ms, threshold.p95Ms, false).tone,
      alert: scoreAgainstThreshold(latestRun.metrics?.p95Ms, threshold.p95Ms, false).alert
        || scoreMetric(latestRun.metrics?.p95Ms, baseline.p95Ms, false).alert,
      deltaPct: scoreMetric(latestRun.metrics?.p95Ms, baseline.p95Ms, false).deltaPct,
      isHealthy: scoreAgainstThreshold(latestRun.metrics?.p95Ms, threshold.p95Ms, false).isHealthy
        ?? scoreMetric(latestRun.metrics?.p95Ms, baseline.p95Ms, false).isHealthy,
    },
    {
      key: "p99",
      label: "P99 latency",
      value: latestRun.metrics?.p99Ms,
      baseline: baseline.p99Ms,
      thresholdMs: null,
      unit: "ms",
      higherIsBetter: false,
      tone: scoreMetric(latestRun.metrics?.p99Ms, baseline.p99Ms, false).tone,
      alert: scoreMetric(latestRun.metrics?.p99Ms, baseline.p99Ms, false).alert,
      deltaPct: scoreMetric(latestRun.metrics?.p99Ms, baseline.p99Ms, false).deltaPct,
      isHealthy: scoreMetric(latestRun.metrics?.p99Ms, baseline.p99Ms, false).isHealthy,
    },
    {
      key: "errorRate",
      label: "Error rate",
      value: latestRun.metrics?.errorRatePct,
      baseline: baseline.errorRatePct,
      thresholdPct: latestRun.thresholds?.errorRatePct ?? null,
      unit: "%",
      higherIsBetter: false,
      tone: scoreAgainstThreshold(latestRun.metrics?.errorRatePct, latestRun.thresholds?.errorRatePct, false).tone,
      alert: scoreAgainstThreshold(latestRun.metrics?.errorRatePct, latestRun.thresholds?.errorRatePct, false).alert
        || scoreMetric(latestRun.metrics?.errorRatePct, baseline.errorRatePct, false).alert,
      deltaPct: scoreMetric(latestRun.metrics?.errorRatePct, baseline.errorRatePct, false).deltaPct,
      isHealthy: scoreAgainstThreshold(latestRun.metrics?.errorRatePct, latestRun.thresholds?.errorRatePct, false).isHealthy
        ?? scoreMetric(latestRun.metrics?.errorRatePct, baseline.errorRatePct, false).isHealthy,
    },
    {
      key: "rps",
      label: "Requests/sec",
      value: latestRun.metrics?.rps,
      baseline: baseline.rps,
      unit: "rps",
      higherIsBetter: true,
      tone: scoreMetric(latestRun.metrics?.rps, baseline.rps, true).tone,
      alert: scoreMetric(latestRun.metrics?.rps, baseline.rps, true).alert,
      deltaPct: scoreMetric(latestRun.metrics?.rps, baseline.rps, true).deltaPct,
      isHealthy: scoreMetric(latestRun.metrics?.rps, baseline.rps, true).isHealthy,
    },
  ] : [];

  const history = sortedRuns.map(run => ({
    id: run.runId,
    runId: run.runId,
    runName: run.runName || run.name || null,
    runUrl: run.runUrl || null,
    createdAt: run.createdAt,
    label: run.label,
    p95Ms: run.metrics?.p95Ms ?? null,
    p99Ms: run.metrics?.p99Ms ?? null,
    errorRatePct: run.metrics?.errorRatePct ?? null,
    rps: run.metrics?.rps ?? null,
    thresholdMs: run.thresholds?.p95Ms ?? null,
    conclusion: run.conclusion || null,
    artifactName: run.artifactName || null,
  }));

  return {
    limit,
    history,
    latestRun: latestRun ? {
      ...history.at(-1),
      baseline,
      metrics: latestRun.metrics,
      thresholds: latestRun.thresholds,
    } : null,
    baseline,
    cards,
    thresholdMs: threshold.p95Ms,
    hasEnoughHistory: history.length >= 2,
    chart: history,
  };
}

export function formatK6MetricValue(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";

  const number = Number(value);
  if (unit === "%") return `${number.toFixed(2)}%`;
  if (unit === "rps") return number.toFixed(number >= 100 ? 0 : 1);
  if (unit === "ms") return `${number.toFixed(number >= 100 ? 0 : 1)} ms`;

  return String(number);
}

export function formatK6Delta(deltaPct) {
  if (deltaPct === null || deltaPct === undefined || Number.isNaN(Number(deltaPct))) return "—";
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct.toFixed(1)}% vs baseline`;
}
