'use client';

import {useEffect, useSyncExternalStore} from 'react';
import {
  DARK_MEDIA_QUERY,
  THEME_MODES,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from '@/utils/theme';

// localStorage と OS 設定という、React の外にある2つの状態を購読する。
// このタブでの変更を伝えるために、購読者を自前で保持している
// （storage イベントは他タブの変更しか飛ばないため）。
const subscribers = new Set<() => void>();

function notify() {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  window.addEventListener('storage', onStoreChange);
  media.addEventListener('change', onStoreChange);

  return () => {
    subscribers.delete(onStoreChange);
    window.removeEventListener('storage', onStoreChange);
    media.removeEventListener('change', onStoreChange);
  };
}

/**
 * 「選択値 実効値」を1つの文字列で返す。
 *
 * useSyncExternalStore のスナップショットは === で比較されるため、
 * オブジェクトではなく文字列にして毎回同じ値なら再描画が起きないようにしている。
 * 実効値も含めるのは、選択値が 'system' のまま OS 側だけ変わった場合にも
 * 変化として検知したいため。
 */
function readThemeState(): string {
  let mode: ThemeMode = 'system';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      mode = stored;
    }
  } catch {
    // プライベートモード等で読めない場合は 'system' 扱いにする
  }

  const resolved: ResolvedTheme =
    mode === 'system' ? (window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light') : mode;

  return `${mode} ${resolved}`;
}

// サーバー描画時は localStorage も matchMedia も無いので 'system' を返す。
// ハイドレーション後に useSyncExternalStore がクライアント値へ差し替える。
function readServerThemeState(): string {
  return 'system light';
}

export default function ThemeToggle() {
  const themeState = useSyncExternalStore(subscribe, readThemeState, readServerThemeState);
  const [mode, resolved] = themeState.split(' ') as [ThemeMode, ResolvedTheme];

  // React の管理外である <html> の属性を、実効値に追従させる。
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  function selectMode(next: ThemeMode) {
    try {
      if (next === 'system') {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // 保存できなくてもこのセッションの表示は切り替える
    }
    notify();
  }

  return (
    <div
      className="flex border border-line"
      role="group"
      aria-label="表示テーマ"
      // ハイドレーション直後にサーバー既定値から実際の選択値へ切り替わるため、
      // 初期描画の不一致は警告させない。
      suppressHydrationWarning
    >
      {THEME_MODES.map((option) => (
        <button
          key={option.mode}
          type="button"
          onClick={() => selectMode(option.mode)}
          aria-pressed={mode === option.mode}
          suppressHydrationWarning
          className={`px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
            mode === option.mode ? 'bg-shu/[0.12] text-shu-lit' : 'text-faint hover:text-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
