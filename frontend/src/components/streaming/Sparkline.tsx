'use client'

// Track 5b/D: tiny inline SVG sparkline used behind hero metric numerals.
// 60×16 px, no chart library, no axis, no tooltip. Linear/Vercel pattern:
// "ghost" line at low opacity behind the big number — high information-
// density without visual noise (RULE 13).

interface SparklineProps {
  data: Array<number | null | undefined>
  width?: number
  height?: number
  className?: string
  strokeWidth?: number
  /** Override colour. Defaults to currentColor at 35% alpha. */
  color?: string
}

export function Sparkline({
  data,
  width = 60,
  height = 16,
  className,
  strokeWidth = 1.25,
  color,
}: SparklineProps) {
  const numeric = data
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
    .filter((v): v is number => v !== null)

  if (numeric.length < 2) {
    // Show a flat baseline when we don't have enough samples; avoids a
    // "broken" empty box on first paint.
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className={className}
        aria-hidden="true"
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke={color ?? 'currentColor'}
          strokeOpacity={0.18}
          strokeWidth={strokeWidth}
        />
      </svg>
    )
  }

  const min = Math.min(...numeric)
  const max = Math.max(...numeric)
  const range = max - min || 1

  // Map each point to (x, y) — earliest sample on the left.
  const stride = numeric.length === 1 ? 0 : (width - 1) / (numeric.length - 1)
  const path = numeric
    .map((value, idx) => {
      const x = idx * stride
      const norm = (value - min) / range // 0 (min) → 1 (max)
      const y = height - 1 - norm * (height - 2) // flip; pad 1px top/bottom
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={color ?? 'currentColor'}
        strokeOpacity={0.55}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
