import { useMemo, useState } from "react";
import {
  formatK6Delta,
  formatK6MetricValue,
} from "../lib/k6Metrics.js";

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

const toneToColor = {
  good: COLORS.success,
  warn: COLORS.warn,
  bad: COLORS.danger,
  neutral: COLORS.info,
  muted: COLORS.textMuted,
};

function formatRunDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Tag({ color = COLORS.accent, children }) {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.08em",
      padding: "3px 8px",
      borderRadius: 4,
      background: `${color}20`,
      color,
      border: `0.5px solid ${color}40`,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{
      border: `0.5px dashed ${COLORS.border}`,
      borderRadius: 10,
      padding: "28px 20px",
      textAlign: "center",
      color: COLORS.textMuted,
      fontSize: 13,
      lineHeight: 1.6,
    }}>
      {message}
    </div>
  );
}

function K6InsufficientHistory({ performance }) {
  const diagnostics = performance?.diagnostics || {};
  const validRuns = Number(diagnostics.validRuns) || 0;
  const missingRuns = Number(diagnostics.missingRuns) || Math.max(0, 2 - validRuns);
  const latestRunUrl = diagnostics.latestRunUrl || performance?.latestRun?.runUrl || null;
  const latestRunLabel = diagnostics.latestRunLabel || "run mais recente";
  const primaryReasonLabel = diagnostics.primaryReasonLabel || "causa não identificada";
  const checklist = Array.isArray(diagnostics.checklist) ? diagnostics.checklist : [];
  const reasonCounts = diagnostics.reasonCounts && typeof diagnostics.reasonCounts === "object"
    ? diagnostics.reasonCounts
    : {};

  return (
    <div style={{
      border: `0.5px dashed ${COLORS.borderHover}`,
      borderRadius: 10,
      padding: "16px 14px",
      background: COLORS.bg,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <EmptyState message="Histórico insuficiente de k6. O dashboard precisa de pelo menos 2 runs com summary JSON para mostrar tendência." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
        <Tag color={COLORS.warn}>{validRuns} run(s) válido(s)</Tag>
        <Tag color={COLORS.info}>faltam {missingRuns} para tendência</Tag>
        <Tag color={COLORS.danger}>causa provável: {primaryReasonLabel}</Tag>
      </div>
      {Object.keys(reasonCounts).length > 0 && (
        <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
          Diagnóstico da ingestão:
          {" "}
          {Object.entries(reasonCounts)
            .map(([reason, count]) => `${count}x ${reason.replaceAll("_", " ")}`)
            .join(" • ")}
        </div>
      )}
      {checklist.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, color: COLORS.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Próximos passos
          </span>
          {checklist.map(step => (
            <span key={step} style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.4 }}>
              • {step}
            </span>
          ))}
        </div>
      )}
      {latestRunUrl && (
        <a
          href={latestRunUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            alignSelf: "flex-start",
            color: COLORS.info,
            fontSize: 12,
            textDecoration: "none",
            border: `0.5px solid ${COLORS.info}66`,
            borderRadius: 6,
            padding: "6px 9px",
          }}
        >
          abrir {latestRunLabel}
        </a>
      )}
    </div>
  );
}

function MetricCard({ metric, latestRun }) {
  const color = toneToColor[metric.tone] || COLORS.textMuted;
  const value = formatK6MetricValue(metric.value, metric.unit);
  const baseline = formatK6MetricValue(metric.baseline, metric.unit);

  return (
    <div style={{
      background: COLORS.bg,
      border: `0.5px solid ${metric.tone === "bad" ? `${COLORS.danger}66` : COLORS.border}`,
      borderRadius: 10,
      padding: "14px 14px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      minHeight: 124,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{
          fontSize: 11,
          color: COLORS.textMuted,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}>
          {metric.label}
        </span>
        <Tag color={color}>{metric.tone === "bad" ? "alerta" : metric.tone === "warn" ? "atenção" : "ok"}</Tag>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textMuted }}>
          baseline {baseline}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: "auto" }}>
        <span style={{ fontSize: 11, color: COLORS.textMuted }}>
          {metric.thresholdMs !== null && metric.thresholdMs !== undefined
            ? `threshold ${formatK6MetricValue(metric.thresholdMs, metric.unit)}`
            : metric.thresholdPct !== null && metric.thresholdPct !== undefined
              ? `threshold ${formatK6MetricValue(metric.thresholdPct, metric.unit)}`
              : metric.higherIsBetter
                ? "meta: manter acima da baseline"
                : "meta: manter abaixo da baseline"}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textDim }}>
          {metric.alert || formatK6Delta(metric.deltaPct)}
        </span>
        {latestRun?.runUrl && (
          <a
            href={latestRun.runUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              color: COLORS.info,
              fontSize: 11,
              textDecoration: "none",
              alignSelf: "flex-start",
            }}
          >
            run de origem
          </a>
        )}
      </div>
    </div>
  );
}

function buildPaths(points, xAccessor, yAccessor) {
  const segments = [];
  let current = [];

  for (const point of points) {
    const x = xAccessor(point);
    const y = yAccessor(point);
    if (x === null || y === null) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push([x, y]);
  }

  if (current.length) segments.push(current);
  return segments;
}

function pathString(segments) {
  return segments.map(segment => segment.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ")).join(" ");
}

function K6TrendChart({ history, thresholdMs }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const width = 1000;
  const height = 320;
  const margin = { top: 28, right: 84, bottom: 56, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const count = history.length;

  const layout = useMemo(() => {
    const p95Values = history.map(point => point.p95Ms).filter(value => Number.isFinite(value));
    const p99Values = history.map(point => point.p99Ms).filter(value => Number.isFinite(value));
    const errorValues = history.map(point => point.errorRatePct).filter(value => Number.isFinite(value));
    const leftMax = Math.max(
      1,
      ...(p95Values.length ? p95Values : [0]),
      ...(p99Values.length ? p99Values : [0]),
      thresholdMs || 0,
    );
    const rightMax = Math.max(1, ...(errorValues.length ? errorValues : [0]));
    const step = count > 1 ? plotWidth / (count - 1) : 0;
    const xForIndex = (index) => margin.left + (count > 1 ? step * index : plotWidth / 2);
    const yLeft = (value) => {
      if (!Number.isFinite(value)) return null;
      return margin.top + plotHeight - ((value / leftMax) * plotHeight);
    };
    const yRight = (value) => {
      if (!Number.isFinite(value)) return null;
      return margin.top + plotHeight - ((value / rightMax) * plotHeight);
    };
    const bars = history.map((point, index) => {
      const value = point.errorRatePct;
      const y = yRight(value);
      const barHeight = y === null ? 0 : (margin.top + plotHeight) - y;
      return {
        ...point,
        index,
        x: xForIndex(index),
        barX: xForIndex(index) - (count > 1 ? Math.min(step * 0.36, 18) : 12),
        barWidth: count > 1 ? Math.min(step * 0.72, 36) : 24,
        barY: y,
        barHeight,
        p95Y: yLeft(point.p95Ms),
        p99Y: yLeft(point.p99Ms),
      };
    });

    return {
      leftMax,
      rightMax,
      bars,
      yLeft,
      yRight,
      xForIndex,
      p95Path: pathString(buildPaths(bars, point => point.x, point => point.p95Y)),
      p99Path: pathString(buildPaths(bars, point => point.x, point => point.p99Y)),
      thresholdY: thresholdMs ? yLeft(thresholdMs) : null,
    };
  }, [count, history, margin.left, margin.top, plotHeight, plotWidth, thresholdMs]);

  const hoveredPoint = hoveredIndex !== null ? layout.bars[hoveredIndex] : null;
  const tooltip = hoveredPoint
    ? {
      leftPct: ((hoveredPoint.x / width) * 100).toFixed(2),
      topPct: `${((hoveredPoint.p95Y ?? hoveredPoint.barY ?? (margin.top + plotHeight / 2)) / height * 100).toFixed(2)}%`,
    }
    : null;

  return (
    <div style={{ position: "relative" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 10,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Tag color={COLORS.accent}>p95 / p99</Tag>
          <Tag color={COLORS.info}>error rate</Tag>
        </div>
        {thresholdMs !== null && thresholdMs !== undefined && (
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>
            threshold p95 {formatK6MetricValue(thresholdMs, "ms")}
          </span>
        )}
      </div>

      <div style={{
        position: "relative",
        width: "100%",
        height: "clamp(280px, 42vw, 360px)",
        border: `0.5px solid ${COLORS.border}`,
        borderRadius: 10,
        overflow: "hidden",
        background: `linear-gradient(180deg, ${COLORS.bg} 0%, ${COLORS.surface} 100%)`,
      }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          style={{ display: "block" }}
        >
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = margin.top + plotHeight - ((tick / 100) * plotHeight);
            return (
              <g key={tick}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y}
                  y2={y}
                  stroke={COLORS.border}
                  strokeDasharray="4 6"
                />
                <text x={16} y={y + 4} fill={COLORS.textMuted} fontSize="10">
                  {Math.round(layout.leftMax * tick / 100)}
                </text>
              </g>
            );
          })}

          {layout.thresholdY !== null && layout.thresholdY !== undefined && (
            <g>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={layout.thresholdY}
                y2={layout.thresholdY}
                stroke={COLORS.warn}
                strokeWidth="1.5"
                strokeDasharray="8 6"
              />
              <text
                x={width - margin.right + 10}
                y={layout.thresholdY + 4}
                fill={COLORS.warn}
                fontSize="10"
              >
                p95 threshold
              </text>
            </g>
          )}

          {layout.bars.map((point) => {
            const alert = Number.isFinite(point.errorRatePct) && point.errorRatePct > 1;
            return (
              <rect
                key={`bar-${point.runId || point.index}`}
                x={point.barX}
                y={point.barY ?? (margin.top + plotHeight)}
                width={point.barWidth}
                height={point.barHeight}
                rx="5"
                fill={alert ? `${COLORS.danger}99` : `${COLORS.info}88`}
              />
            );
          })}

          {layout.p95Path && (
            <path
              d={layout.p95Path}
              fill="none"
              stroke={COLORS.accent}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {layout.p99Path && (
            <path
              d={layout.p99Path}
              fill="none"
              stroke={COLORS.info}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="10 6"
            />
          )}

          {layout.bars.map((point) => (
            <g key={`point-${point.runId || point.index}`}>
              {Number.isFinite(point.p95Y) && (
                <circle cx={point.x} cy={point.p95Y} r="4.5" fill={COLORS.accent} stroke={COLORS.bg} strokeWidth="2" />
              )}
              {Number.isFinite(point.p99Y) && (
                <circle cx={point.x} cy={point.p99Y} r="4" fill={COLORS.info} stroke={COLORS.bg} strokeWidth="2" />
              )}
            </g>
          ))}

          {layout.bars.map((point, index) => (
            <rect
              key={`hover-${point.runId || point.index}`}
              x={point.x - (count > 1 ? Math.max((layout.bars[1]?.x - layout.bars[0]?.x) * 0.38, 16) : 24)}
              y={margin.top}
              width={count > 1 ? Math.max((layout.bars[1]?.x - layout.bars[0]?.x) * 0.76, 28) : 48}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseMove={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: "crosshair" }}
            />
          ))}

          {history.map((point, index) => {
            const x = layout.xForIndex(index);
            const xLabelY = height - 18;
            const showLabel = count <= 6 || index === 0 || index === count - 1 || index % 2 === 0;
            return (
              <text
                key={`label-${point.runId || point.index}`}
                x={x}
                y={xLabelY}
                fill={COLORS.textMuted}
                fontSize="10"
                textAnchor="middle"
                opacity={showLabel ? 1 : 0}
              >
                {point.label}
              </text>
            );
          })}
        </svg>

        {hoveredPoint && tooltip && (
          <div
            style={{
              position: "absolute",
              left: `${tooltip.leftPct}%`,
              top: tooltip.topPct,
              transform: "translate(-50%, -100%)",
              background: "rgba(10, 12, 15, 0.96)",
              border: `0.5px solid ${COLORS.borderHover}`,
              borderRadius: 8,
              padding: "10px 12px",
              minWidth: 220,
              boxShadow: "0 14px 35px rgba(0, 0, 0, 0.35)",
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: 12, color: COLORS.text }}>
                {hoveredPoint.runName || hoveredPoint.label}
              </strong>
              <span style={{ fontSize: 10, color: COLORS.textMuted }}>
                {formatRunDate(hoveredPoint.createdAt)}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, fontSize: 11, color: COLORS.textMuted }}>
              <span>p95: {formatK6MetricValue(hoveredPoint.p95Ms, "ms")}</span>
              <span>p99: {formatK6MetricValue(hoveredPoint.p99Ms, "ms")}</span>
              <span>error: {formatK6MetricValue(hoveredPoint.errorRatePct, "%")}</span>
              <span>rps: {formatK6MetricValue(hoveredPoint.rps, "rps")}</span>
            </div>
            {hoveredPoint.runUrl && (
              <div style={{ marginTop: 8 }}>
                <a
                  href={hoveredPoint.runUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: COLORS.info, fontSize: 11, textDecoration: "none" }}
                >
                  abrir run
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginTop: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: COLORS.textMuted, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS.accent }} />
          p95
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: COLORS.textMuted, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS.info }} />
          p99
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: COLORS.textMuted, fontSize: 11 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS.info, opacity: 0.8 }} />
          error rate
        </div>
      </div>
    </div>
  );
}

export default function K6PerformanceSection({ performance }) {
  const latestRun = performance?.latestRun || null;
  const hasEnoughHistory = !!performance?.hasEnoughHistory && (performance?.history?.length || 0) >= 2;

  return (
    <section style={{
      background: COLORS.surface,
      border: `0.5px solid ${COLORS.border}`,
      borderRadius: 10,
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16 }}>◎</span>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>Performance</span>
            <Tag>K6</Tag>
          </div>
          <span style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
            Últimos runs do `futuru-k6` com comparação contra baseline recente e threshold do p95.
          </span>
        </div>
        {latestRun?.runUrl && (
          <a
            href={latestRun.runUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              color: COLORS.info,
              fontSize: 11,
              textDecoration: "none",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            run de origem
          </a>
        )}
      </div>

      {!hasEnoughHistory
        ? (
          <K6InsufficientHistory performance={performance} />
        )
        : (
          <>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12,
            }}>
              {performance.cards.map(card => (
                <MetricCard key={card.key} metric={card} latestRun={latestRun} />
              ))}
            </div>

            <K6TrendChart
              history={performance.chart}
              thresholdMs={performance.thresholdMs}
            />
          </>
        )}
    </section>
  );
}
