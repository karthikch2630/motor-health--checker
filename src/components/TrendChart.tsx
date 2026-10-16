import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MIN_POINTS_FOR_TREND, type TrendSeries } from '../lib/trends'

const fmtDate = (t: number) => new Date(t).toLocaleDateString()

/**
 * One comparable series at a time (same parameter, unit, method and location). The chart shows measured
 * values only. It draws no limits and makes no judgement; assessments carry the interpretation.
 */
export default function TrendChart({ series }: { series: TrendSeries[] }) {
  const [key, setKey] = useState(() => (series.find((s) => s.plottable) ?? series[0])?.key ?? '')
  const current = series.find((s) => s.key === key) ?? series[0]
  if (!current) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <label htmlFor="trend-series" className="block text-sm font-medium text-slate-700">
        Series
      </label>
      <select
        id="trend-series"
        value={current.key}
        onChange={(e) => setKey(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      >
        {series.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label} — {s.points.length} reading{s.points.length === 1 ? '' : 's'}
            {s.plottable ? '' : ' (too few to chart)'}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs text-slate-500">
        Only readings with the same parameter, unit, method and location are compared. Readings that differ in any of these
        appear as separate series.
      </p>

      {current.plottable ? (
        <div className="mt-4 h-72 w-full" role="img" aria-label={`Trend of ${current.parameterName} in ${current.unit} over time`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={current.points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtDate} fontSize={12} />
              <YAxis
                fontSize={12}
                domain={['auto', 'auto']}
                label={{ value: current.unit, angle: -90, position: 'insideLeft', fontSize: 12 }}
              />
              <Tooltip
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                formatter={(v) => [`${v} ${current.unit}`, current.parameterName]}
              />
              <Line type="linear" dataKey="value" stroke="#b45309" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          A trend needs at least {MIN_POINTS_FOR_TREND} comparable readings; this series has {current.points.length}.
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Show values as a table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">{current.label}</caption>
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="py-1 pr-3">Test date</th>
              <th scope="col" className="py-1">Value ({current.unit})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {current.points.map((p) => (
              <tr key={p.sessionId}>
                <td className="py-1 pr-3">{new Date(p.t).toLocaleString()}</td>
                <td className="py-1">{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
