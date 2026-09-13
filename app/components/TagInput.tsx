'use client';

import {useEffect, useId, useMemo, useRef, useState, type KeyboardEvent} from 'react';

const MAX_SUGGESTIONS = 8;

/**
 * タグの入力欄。確定済みのタグを片（チップ）として並べ、入力中は既存タグを候補に出す。
 *
 * Server Action 側は今も「カンマ区切りの1本の文字列」を受け取る仕様なので、
 * 確定分は隠し input にカンマで連結して載せる。
 *
 * @param suggestions 既に tags テーブルにあるタグ名。候補の母集合になる。
 * @param defaultTags 編集時に既に付いているタグ名。
 */
export default function TagInput({
  name,
  suggestions,
  defaultTags = [],
}: {
  name: string;
  suggestions: string[];
  defaultTags?: string[];
}) {
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const trimmedQuery = query.trim();

  const matches = useMemo(() => {
    const chosen = new Set(tags.map((tag) => tag.toLowerCase()));
    const needle = trimmedQuery.toLowerCase();
    return suggestions
      .filter((suggestion) => !chosen.has(suggestion.toLowerCase()))
      .filter((suggestion) => needle === '' || suggestion.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, tags, trimmedQuery]);

  // 入力中の文字列が既存タグにも確定済みタグにも無いときだけ、新規作成の行を足す。
  const canCreate =
    trimmedQuery !== '' &&
    ![...suggestions, ...tags].some((tag) => tag.toLowerCase() === trimmedQuery.toLowerCase());

  const options: {kind: 'existing' | 'create'; value: string}[] = [
    ...matches.map((value) => ({kind: 'existing' as const, value})),
    ...(canCreate ? [{kind: 'create' as const, value: trimmedQuery}] : []),
  ];

  // 入力や確定で候補が入れ替わると activeIndex が末尾を追い越すことがあるので、参照時に丸める。
  const highlighted = options.length === 0 ? 0 : Math.min(activeIndex, options.length - 1);

  // 枠の外をクリックしたら候補を閉じる。
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  function commit(value: string) {
    const tag = value.trim();
    if (tag === '') {
      return;
    }
    setTags((current) =>
      current.some((existing) => existing.toLowerCase() === tag.toLowerCase()) ? current : [...current, tag],
    );
    setQuery('');
    setActiveIndex(0);
    setIsOpen(false);
    textInputRef.current?.focus();
  }

  function removeTag(target: string) {
    setTags((current) => current.filter((tag) => tag !== target));
    textInputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 日本語入力の変換確定でも Enter が飛ぶため、変換中のキーはタグ確定として扱わない。
    if (event.nativeEvent.isComposing) {
      return;
    }

    const active = options[highlighted];

    switch (event.key) {
      // 丸めた highlighted を起点にする。素の activeIndex は範囲外を指していることがある。
      case 'ArrowDown':
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex(options.length === 0 ? 0 : (highlighted + 1) % options.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex(options.length === 0 ? 0 : (highlighted - 1 + options.length) % options.length);
        return;
      case 'Enter':
      case ',':
      case 'Tab': {
        // Tab は候補を選んでいるときだけ横取りし、それ以外はフォーカス移動に譲る。
        const picked = isOpen && active ? active.value : trimmedQuery;
        if (picked === '' || (event.key === 'Tab' && !(isOpen && active))) {
          return;
        }
        event.preventDefault();
        commit(picked);
        return;
      }
      case 'Backspace':
        if (query === '' && tags.length > 0) {
          event.preventDefault();
          removeTag(tags[tags.length - 1]);
        }
        return;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          setIsOpen(false);
        }
        return;
      default:
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-baseline justify-between">
        <span className="kicker">Tags</span>
        {tags.length > 0 && <span className="tnum font-mono text-[10px] text-faint">{tags.length}</span>}
      </div>

      {/* Server Action には従来どおりカンマ区切りで渡す。 */}
      <input type="hidden" name={name} value={tags.join(',')} />

      <div
        onClick={() => textInputRef.current?.focus()}
        className="mt-2.5 flex flex-wrap items-center gap-1.5 border border-line bg-raise/50 p-2 transition-colors focus-within:border-shu focus-within:bg-raise"
      >
        {tags.map((tag) => (
          <span key={tag} className="chip chip-on">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`タグ「${tag}」を外す`}
              className="-mr-0.5 px-1 leading-none text-shu-lit/60 transition-colors hover:text-shu-lit"
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={textInputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // 候補の並びが変わるので、選択位置は毎回先頭に戻す。
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'タグを入力（Enter で確定）' : ''}
          role="combobox"
          aria-expanded={isOpen && options.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && options[highlighted] ? `${listboxId}-${highlighted}` : undefined
          }
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-[13px] text-text placeholder:text-faint/80 focus:outline-none"
        />
      </div>

      {isOpen && options.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto border border-line bg-panel shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)]"
        >
          {options.map((option, index) => (
            <li
              key={`${option.kind}-${option.value}`}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                // mousedown の既定動作で入力欄がフォーカスを失うのを防ぐ。
                event.preventDefault();
                commit(option.value);
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13px] transition-colors ${
                index === highlighted ? 'bg-shu/[0.14] text-shu-lit' : 'text-dim'
              }`}
            >
              <span className="truncate">{option.value}</span>
              <span className="kicker shrink-0">{option.kind === 'create' ? 'New' : 'Tag'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
