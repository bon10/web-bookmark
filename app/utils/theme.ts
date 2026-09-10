/**
 * テーマ（淡／濃）の設定値の扱いを一箇所に集める。
 *
 * 選択値は3つ：'system'（OS設定に従う）／'light'／'dark'。
 * 実際に <html data-theme> に載るのは 'light' か 'dark' のどちらかで、
 * 'system' は matchMedia で解決してから載せる。
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tube-bookmark:theme';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export const THEME_MODES: {mode: ThemeMode; label: string}[] = [
  {mode: 'system', label: 'auto'},
  {mode: 'light', label: 'light'},
  {mode: 'dark', label: 'dark'},
];

/**
 * 初回描画前に <html data-theme> を確定させるスクリプト。
 *
 * layout.tsx の <head> に同期スクリプトとして差し込む。React のハイドレーションより
 * 前に走らせないと、一瞬だけ既定テーマが見えてしまう（いわゆる FOUC）。
 *
 * このファイルの readThemeState() と判定条件を必ず揃えること。
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var m=localStorage.getItem('${THEME_STORAGE_KEY}');if(m!=='light'&&m!=='dark'){m=window.matchMedia('${DARK_MEDIA_QUERY}').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',m)}catch(e){}})()`;
