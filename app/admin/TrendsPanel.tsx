"use client";

import { useState } from "react";

type Point = { date: string; count: number };
type Series = { daily: Point[]; weekly: Point[]; monthly: Point[] };
type Metric = "queries" | "conversations" | "signups";
type Period = "daily" | "weekly" | "monthly";

const METRIC_LABELS: Record<Metric, string> = {
  queries: "질문 수",
  conversations: "신규 대화",
  signups: "가입자",
};
const METRIC_ACCENTS: Record<Metric, string> = {
  queries: "var(--c-primary)",
  conversations: "var(--c-primary-deep)",
  signups: "#22c55e",
};
const PERIOD_LABELS: Record<Period, string> = {
  daily: "일별 (30일)",
  weekly: "주별 (12주)",
  monthly: "월별 (12개월)",
};

export default function TrendsPanel({
  queries,
  conversations,
  signups,
}: {
  queries: Series;
  conversations: Series;
  signups: Series;
}) {
  const [metric, setMetric] = useState<Metric>("queries");
  const [period, setPeriod] = useState<Period>("daily");

  const seriesByMetric = { queries, conversations, signups };
  const series = seriesByMetric[metric][period];
  const accent = METRIC_ACCENTS[metric];

  const max = Math.max(1, ...series.map((p) => p.count));
  const total = series.reduce((sum, p) => sum + p.count, 0);
  const width = 800;
  const height = 200;
  const barWidth = width / series.length;

  return (
    <div style={{
      padding: "20px 24px",
      borderRadius: "10px",
      border: "1px solid var(--c-hairline)",
      background: "var(--c-canvas-soft)",
    }}>
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "16px",
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <Filter
            label="지표"
            value={metric}
            options={[
              { value: "queries", label: "질문 수" },
              { value: "conversations", label: "신규 대화" },
              { value: "signups", label: "가입자" },
            ]}
            onChange={(v) => setMetric(v as Metric)}
          />
          <Filter
            label="기간"
            value={period}
            options={[
              { value: "daily", label: "일별" },
              { value: "weekly", label: "주별" },
              { value: "monthly", label: "월별" },
            ]}
            onChange={(v) => setPeriod(v as Period)}
          />
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", color: "var(--c-ink-mute)", marginBottom: "2px" }}>
            {METRIC_LABELS[metric]} · {PERIOD_LABELS[period]}
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.3px" }}>
            {total.toLocaleString()}
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        {series.map((p, i) => {
          const h = (p.count / max) * (height - 4);
          const x = i * barWidth;
          const y = height - h;
          return (
            <rect
              key={p.date}
              x={x + 1}
              y={y}
              width={Math.max(barWidth - 2, 1)}
              height={h}
              fill={accent}
              opacity={p.count === 0 ? 0.15 : 0.85}
              rx="2"
            >
              <title>{`${p.date}: ${p.count}`}</title>
            </rect>
          );
        })}
      </svg>

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: "8px",
        fontSize: "10px",
        color: "var(--c-ink-mute)",
      }}>
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "11px", color: "var(--c-ink-mute)", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <div style={{
        display: "inline-flex",
        borderRadius: "8px",
        border: "1px solid var(--c-hairline)",
        background: "var(--c-canvas)",
        overflow: "hidden",
      }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              style={{
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: active ? 500 : 400,
                background: active ? "var(--c-primary-subtle)" : "transparent",
                color: active ? "var(--c-primary)" : "var(--c-ink)",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 0.1s, color 0.1s",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
