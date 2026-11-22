import React, { useState } from 'react';
import { formatCompactCurrency, formatCurrency } from '../utils/format';

export interface TrendPoint {
  label: string;
  income: number;
  expenses: number;
  profit: number;
}

interface FinancialTrendChartProps {
  data: TrendPoint[];
  currency: string;
  height?: number;
}

export const FinancialTrendChart: React.FC<FinancialTrendChartProps> = ({
  data,
  currency,
  height = 260,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-slate-400">
        No financial periods recorded yet.
      </div>
    );
  }

  const maxVal = Math.max(
    100000,
    ...data.flatMap((d) => [d.income, d.expenses, Math.max(0, d.profit)])
  );

  const svgWidth = 720;
  const svgHeight = height;
  const padLeft = 64;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 36;
  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  const groupWidth = chartW / data.length;
  const barWidth = Math.min(20, Math.max(8, (groupWidth - 16) / 3));

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const hovered = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-5 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#0B1D3A]" />
            Income
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-rose-500" />
            Expenses
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#C89B3C]" />
            Net Profit
          </span>
        </div>
        {hovered && (
          <div className="text-xs font-mono tabular-nums text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md">
            <span className="font-semibold text-slate-900 mr-2">{hovered.label}:</span>
            <span>In {formatCurrency(hovered.income, currency)}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span>Out {formatCurrency(hovered.expenses, currency)}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className={hovered.profit >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
              Net {formatCurrency(hovered.profit, currency)}
            </span>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto overflow-visible select-none"
        role="img"
        aria-label="Income, Expenses, and Net Profit trend chart"
      >
        {yTicks.map((t) => {
          const y = padTop + chartH - t * chartH;
          const val = maxVal * t;
          return (
            <g key={t}>
              <line
                x1={padLeft}
                x2={svgWidth - padRight}
                y1={y}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray={t === 0 ? undefined : '3 3'}
              />
              <text
                x={padLeft - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono"
              >
                {formatCompactCurrency(val, '')}
              </text>
            </g>
          );
        })}

        {data.map((d, idx) => {
          const cx = padLeft + idx * groupWidth + groupWidth / 2;
          const hIncome = (d.income / maxVal) * chartH;
          const hExp = (d.expenses / maxVal) * chartH;
          const hProfit = (Math.max(0, d.profit) / maxVal) * chartH;
          const isActive = hoverIdx === idx;

          return (
            <g
              key={d.label}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            >
              {isActive && (
                <rect
                  x={padLeft + idx * groupWidth + 2}
                  y={padTop}
                  width={Math.max(4, groupWidth - 4)}
                  height={chartH}
                  fill="#F1F5F9"
                  rx={4}
                />
              )}

              <rect
                x={cx - barWidth * 1.5 - 2}
                y={padTop + chartH - hIncome}
                width={barWidth}
                height={Math.max(2, hIncome)}
                fill="#0B1D3A"
                rx={2}
              />
              <rect
                x={cx - barWidth * 0.5}
                y={padTop + chartH - hExp}
                width={barWidth}
                height={Math.max(2, hExp)}
                fill="#F43F5E"
                rx={2}
              />
              <rect
                x={cx + barWidth * 0.5 + 2}
                y={padTop + chartH - hProfit}
                width={barWidth}
                height={Math.max(2, hProfit)}
                fill="#C89B3C"
                rx={2}
              />

              <text
                x={cx}
                y={svgHeight - 12}
                textAnchor="middle"
                className={`text-[11px] ${isActive ? 'fill-slate-900 font-semibold' : 'fill-slate-500'}`}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export interface RankItem {
  label: string;
  sublabel?: string;
  value: number;
  secondaryValue?: number;
}

interface HorizontalRankChartProps {
  items: RankItem[];
  currency: string;
  barColorClass?: string;
  emptyText?: string;
}

export const HorizontalRankChart: React.FC<HorizontalRankChartProps> = ({
  items,
  currency,
  barColorClass = 'bg-[#0B1D3A]',
  emptyText = 'No data available for this metric yet.',
}) => {
  if (!items || items.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">{emptyText}</p>;
  }

  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="space-y-3.5">
      {items.map((item) => {
        const pct = Math.min(100, Math.max(3, (item.value / max) * 100));
        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 truncate">{item.label}</p>
                {item.sublabel && (
                  <p className="text-xs text-slate-500 truncate">{item.sublabel}</p>
                )}
              </div>
              <span className="font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap shrink-0">
                {formatCurrency(item.value, currency)}
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
              <div
                className={`h-full rounded-sm transition-all duration-300 ${barColorClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
