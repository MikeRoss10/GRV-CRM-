"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Single-series weekly bar chart. Two measures get two charts, never a dual axis. */
export function WeeklyChart({
  data, color = "#2a78d6", label, currency,
}: {
  data: Array<{ week: string; value: number }>;
  color?: string;
  label: string;
  currency?: string;
}) {
  const fmt = (v: number) =>
    currency ? `₹${v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}` : String(v);
  return (
    <div className="h-44 w-full" role="img" aria-label={`${label} by week`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="#e8e5df" strokeDasharray="0" />
          <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: "#e8e5df" }} tick={{ fontSize: 11, fill: "#8b909a" }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8b909a" }} tickFormatter={fmt} allowDecimals={false} width={48} />
          <Tooltip
            cursor={{ fill: "rgba(13,27,54,0.05)" }}
            contentStyle={{ borderRadius: 10, border: "1px solid #e8e5df", fontSize: 12, boxShadow: "0 8px 24px -8px rgba(13,27,54,.2)" }}
            formatter={(v) => [currency ? `₹${Math.round(Number(v)).toLocaleString("en-IN")}` : v, label]}
            labelFormatter={(l) => `Week of ${l}`}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
