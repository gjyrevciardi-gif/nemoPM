import { useId, useMemo, useState } from "react";
import type { SprintBurndown } from "@ai-pm/shared";

const WIDTH = 560;
const HEIGHT = 160;
const PAD = { top: 10, right: 12, bottom: 22, left: 32 };
const ACCENT = "#E9A23B";

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function BurndownChart({ burndown }: { burndown: SprintBurndown }) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const points = burndown.points;
  const yMax = useMemo(() => niceMax(burndown.totalPoints), [burndown.totalPoints]);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const xForIndex = (i: number) => (points.length <= 1 ? 0 : (i / (points.length - 1)) * plotW);
  const yForValue = (v: number) => plotH - (v / yMax) * plotH;

  if (points.length === 0) {
    return <p className="text-sm text-ink-muted">Burndown appears once the sprint has started.</p>;
  }

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i).toFixed(1)} ${yForValue(p.remainingPoints).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${xForIndex(points.length - 1).toFixed(1)} ${plotH} L 0 ${plotH} Z`;

  const yTicks = [0, yMax / 2, yMax];

  // Only label a handful of x-axis ticks to avoid crowding on longer sprints.
  const xTickIndices =
    points.length <= 6
      ? points.map((_, i) => i)
      : Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));

  const hovered = hoverIndex != null ? points[hoverIndex] : null;

  function handlePointerMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = plotW === 0 ? 0 : Math.min(1, Math.max(0, x / plotW));
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIndex(idx);
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-medium text-ink">Burndown — remaining points</h4>
        <button
          className="text-xs text-ink-faint hover:text-ink-muted"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
        >
          {showTable ? "Hide table" : "View as table"}
        </button>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Burndown chart: ${burndown.totalPoints} total points, currently ${points[points.length - 1]?.remainingPoints ?? 0} remaining`}
        className="mt-2 w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.1" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={yForValue(t)} y2={yForValue(t)} stroke="#262C39" strokeWidth={1} />
              <text x={-8} y={yForValue(t)} textAnchor="end" dominantBaseline="middle" className="fill-ink-faint text-[9px]">
                {Math.round(t)}
              </text>
            </g>
          ))}

          {xTickIndices.map((i) => (
            <text
              key={i}
              x={xForIndex(i)}
              y={plotH + 16}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-ink-faint text-[9px]"
            >
              {formatDate(points[i]!.date)}
            </text>
          ))}

          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {points.map((p, i) => {
            const isLast = i === points.length - 1;
            const isHovered = i === hoverIndex;
            if (!isLast && !isHovered) return null;
            return (
              <circle
                key={p.date}
                cx={xForIndex(i)}
                cy={yForValue(p.remainingPoints)}
                r={4}
                fill={ACCENT}
                stroke="#161A22"
                strokeWidth={2}
              />
            );
          })}

          {hoverIndex != null && (
            <line
              x1={xForIndex(hoverIndex)}
              x2={xForIndex(hoverIndex)}
              y1={0}
              y2={plotH}
              stroke="#666E82"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}

          <text
            x={xForIndex(points.length - 1) - 4}
            y={yForValue(points[points.length - 1]!.remainingPoints) - 8}
            textAnchor="end"
            className="fill-ink text-[10px] font-medium"
          >
            {points[points.length - 1]!.remainingPoints}
          </text>

          <rect
            x={0}
            y={0}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
          />
        </g>
      </svg>

      {hovered && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="inline-block h-0.5 w-3" style={{ backgroundColor: ACCENT }} />
          <span className="font-medium text-ink">{hovered.remainingPoints} pts remaining</span>
          <span className="text-ink-faint">{formatDate(hovered.date)}</span>
        </div>
      )}

      {showTable && (
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="text-ink-faint">
              <th className="py-1 pr-3 font-normal">Date</th>
              <th className="py-1 pr-3 font-normal">Remaining</th>
              <th className="py-1 font-normal">Completed</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-t border-border-subtle">
                <td className="py-1 pr-3 text-ink-muted">{formatDate(p.date)}</td>
                <td className="py-1 pr-3 text-ink">{p.remainingPoints}</td>
                <td className="py-1 text-ink-muted">{p.completedPoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
