const STARS = '★★★★★';
const MAX_RATING = 5;

/**
 * 読み取り専用の星評価表示。
 * 0.5 刻みに丸めず、value をそのまま幅の割合に変換して部分的に塗る。
 */
export default function StarRating({value, size = 12}: {value: number; size?: number}) {
  const clamped = Math.max(0, Math.min(MAX_RATING, value));
  const filledWidth = `${(clamped / MAX_RATING) * 100}%`;

  return (
    <span
      className="relative inline-block whitespace-nowrap leading-none"
      style={{fontSize: size}}
      role="img"
      aria-label={`${MAX_RATING}段階中 ${clamped.toFixed(1)}`}
    >
      <span className="text-gray-300">{STARS}</span>
      <span
        className="absolute left-0 top-0 overflow-hidden text-yellow-400"
        style={{width: filledWidth}}
        aria-hidden="true"
      >
        {STARS}
      </span>
    </span>
  );
}
