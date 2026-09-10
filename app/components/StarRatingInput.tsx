'use client';

import {useState} from 'react';
import StarRating from '@/components/StarRating';

const MAX_RATING = 5;
// 星ごとに左半分・右半分の2つの当たり判定を置き、0.5 刻みで指定できるようにする。
const STEPS = Array.from({length: MAX_RATING * 2}, (_, index) => (index + 1) / 2);

/**
 * ブックマークの評価の入力欄。値は隠し input で Server Action に渡す。
 * 未評価は空文字にしておく（DB 側 videos.rating の CHECK 制約が 1〜5 のため、0 を送らない）。
 */
export default function StarRatingInput({name}: {name: string}) {
  const [value, setValue] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  const shown = hovered ?? value;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="kicker">Rating</span>
        {value > 0 && (
          <button
            type="button"
            onClick={() => setValue(0)}
            className="font-mono text-[10px] text-faint transition-colors hover:text-shu-lit"
          >
            clear
          </button>
        )}
      </div>

      <input type="hidden" name={name} value={value > 0 ? value.toFixed(1) : ''} />

      <div className="mt-2.5 flex items-center gap-3">
        <div
          className="relative inline-block"
          onMouseLeave={() => setHovered(null)}
          role="group"
          aria-label="評価"
        >
          <StarRating value={shown} size={22} />
          <div className="absolute inset-0 flex">
            {STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setValue(step)}
                onMouseEnter={() => setHovered(step)}
                onFocus={() => setHovered(step)}
                onBlur={() => setHovered(null)}
                aria-label={`${step.toFixed(1)} をつける`}
                aria-pressed={value === step}
                className="h-full flex-1 cursor-pointer"
              />
            ))}
          </div>
        </div>

        <span className="tnum font-mono text-[12px] text-faint">
          {shown > 0 ? shown.toFixed(1) : '—'}
        </span>
      </div>
    </div>
  );
}
