'use client';

// ユビキタス言語: docs/ubiquitous-language.md
// 1件のブックマークが持つサムネイル（複数可）の表示。

import {useRef, useState} from 'react';
import Image from 'next/image';

type Thumbnail = {id: number; url: string};

/**
 * サムネイルを横スクロールで見せる。
 *
 * 1枚のときは素の画像として描画し、スクロール枠も送り操作も出さない
 * （枚数を示す UI が常時出ていると、1枚しかない大多数のカードで邪魔になるため）。
 *
 * @param sizes next/image に渡すレスポンシブ指定。カードと一覧行で表示幅が違うので呼び出し側から渡す。
 */
export default function ThumbnailCarousel({
  thumbnails,
  sizes,
}: {
  thumbnails: Thumbnail[];
  sizes: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  if (thumbnails.length === 0) {
    return (
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center font-display text-4xl text-line"
      >
        栞
      </span>
    );
  }

  if (thumbnails.length === 1) {
    return (
      <Image
        src={thumbnails[0].url}
        alt=""
        fill
        sizes={sizes}
        className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
      />
    );
  }

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.clientWidth === 0) {
      return;
    }
    const index = Math.round(scroller.scrollLeft / scroller.clientWidth);
    // スクロール中は毎フレーム発火するので、実際に面が変わったときだけ再描画する。
    setActiveIndex((current) => (current === index ? current : index));
  }

  function scrollToIndex(index: number) {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    scroller.scrollTo({left: index * scroller.clientWidth, behavior: 'smooth'});
  }

  return (
    <>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {thumbnails.map((thumbnail, index) => (
          <div key={thumbnail.id} className="relative h-full w-full shrink-0 snap-center">
            <Image
              src={thumbnail.url}
              alt={`サムネイル ${index + 1} / ${thumbnails.length}`}
              fill
              sizes={sizes}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {/* 送り操作。枚数と現在位置を常に見せる。 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-2">
        <div className="pointer-events-auto flex items-center gap-2 bg-ink/80 px-2.5 py-1.5 backdrop-blur-sm">
          <span className="tnum font-mono text-[10px] leading-none text-dim">
            {activeIndex + 1}/{thumbnails.length}
          </span>
          <span className="flex items-center gap-1.5">
            {thumbnails.map((thumbnail, index) => (
              <button
                key={thumbnail.id}
                type="button"
                onClick={() => scrollToIndex(index)}
                aria-label={`${index + 1}枚目を表示`}
                aria-current={index === activeIndex}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  index === activeIndex ? 'bg-shu' : 'bg-faint hover:bg-text'
                }`}
              />
            ))}
          </span>
        </div>
      </div>
    </>
  );
}
