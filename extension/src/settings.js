// 接続先の設定。アプリの URL と Supabase のプロジェクト情報を持つ。
//
// 同梱せず設定画面から入れる形にしているのは、この拡張を配布物としてではなく
// 手元で読み込んで使う前提にしているため（開発中は localhost、普段は公開先を向ける）。
//
// publishable key はブラウザへ配信される前提の公開キーなので、拡張のストレージに
// 置いてよい。R2 の資格情報や secret key は拡張に持ち込まない（誰でも展開して読めるため）。

const DEFAULTS = {
  appBaseUrl: 'http://localhost:3000',
  supabaseUrl: '',
  supabasePublishableKey: '',
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {...DEFAULTS, ...stored};
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({
    appBaseUrl: settings.appBaseUrl.replace(/\/+$/, ''),
    supabaseUrl: settings.supabaseUrl.replace(/\/+$/, ''),
    supabasePublishableKey: settings.supabasePublishableKey.trim(),
  });
}

export function isConfigured(settings) {
  return Boolean(settings.appBaseUrl && settings.supabaseUrl && settings.supabasePublishableKey);
}

/**
 * 画像の取得に使うホスト権限が揃っているかを返す。
 *
 * 画像は「ページ上に表示されている URL を拡張が取得し直して本文ごと送る」方式なので、
 * 任意のホストへの fetch が必要になる。service worker の fetch は host_permissions が
 * あれば自オリジン外へ出られる（content script からの fetch は CORS で止まるため使えない）。
 * 出典: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
 */
export async function hasImageAccess() {
  return chrome.permissions.contains({origins: ['https://*/*', 'http://*/*']});
}
