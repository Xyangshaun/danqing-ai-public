// ============================================================
// 总分环形图(SVG,打印/Canvas 友好)
// ============================================================

interface ScoreRingProps {
  /** 总分;批次⑤:基础检测不产分时为 null,显示"— 未评分"而非假 0 分 */
  score: number | null; // 0-100
  size?: number; // 直径 px
  strokeWidth?: number;
  /** 环形颜色(默认朱砂) */
  color?: string;
  /** 中心副文案(如 "总分") */
  caption?: string;
}

/** 按分数段取色:≥85 玉色 / ≥70 石青 / ≥60 金色 / <60 朱砂 */
export function scoreColor(score: number): string {
  if (score >= 85) return '#5b8c5a';
  if (score >= 70) return '#2e5fa1';
  if (score >= 60) return '#d4af37';
  return '#c41e3a';
}

export default function ScoreRing({
  score,
  size = 120,
  strokeWidth = 10,
  color,
  caption = '总分',
}: ScoreRingProps) {
  // 批次⑤:null(基础检测未评分)→ 空环 + "—",不再以 0 分假显示
  const hasScore = score !== null;
  const clamped = hasScore ? Math.max(0, Math.min(100, score)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const ringColor = color ?? scoreColor(clamped);

  return (
    <div
      className="inline-flex flex-col items-center"
      role="img"
      aria-label={hasScore ? `总分 ${clamped} 分` : '尚未评分'}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 底环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#ede8df"
          strokeWidth={strokeWidth}
        />
        {/* 分数环(-90° 起;未评分时不绘制) */}
        {hasScore && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.28}
          fontWeight={700}
          fill="#0f0f0f"
          fontFamily="'Noto Serif SC','Songti SC',serif"
        >
          {hasScore ? clamped : '—'}
        </text>
        <text
          x="50%"
          y="68%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.11}
          fill="#737373"
        >
          {hasScore ? caption : '未评分'}
        </text>
      </svg>
    </div>
  );
}
