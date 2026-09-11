// service worker。ログインとサーバーへの送信はすべてここで行う。
//
// ポップアップではなくここに寄せている理由は2つ。
//   1. アクセストークンを content script から遠ざける（ページ側に漏らさない）
//   2. service worker の fetch だけが host_permissions によって自オリジン外へ出られる
//      （content script の fetch は注入先ページのオリジン扱いで CORS に阻まれる）
//      https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

import {loadSettings, isConfigured} from './settings.js';
import {getAccessToken, getSession, signIn, signOut} from './session.js';

const DRAFT_KEY = 'draft';

/** Content-Type から R2 のオブジェクトキーに使う拡張子を決める。 */
const EXTENSION_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

async function authorizedFetch(path, init = {}) {
  const settings = await loadSettings();
  if (!isConfigured(settings)) {
    throw new Error('接続先が未設定です。拡張の設定画面で入力してください。');
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('ログインが必要です。');
  }

  const response = await fetch(`${settings.appBaseUrl}${path}`, {
    ...init,
    headers: {...(init.headers ?? {}), Authorization: `Bearer ${accessToken}`},
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

/**
 * 選んだ画像を送信できる形（Blob）にする。
 *
 * 画像 URL はここで取得し直す。サーバーから取りに行くと参照元ページの Cookie を
 * 付けられず 403 を返すサイトがあるため、ページを開いている拡張側で取る。
 * 動画から抜いた静止画は data URL で渡ってくるので、そのまま Blob に変換する。
 */
async function toBlob(image) {
  if (image.kind === 'dataUrl') {
    const response = await fetch(image.value);
    return response.blob();
  }

  let response;
  try {
    response = await fetch(image.value, {credentials: 'include'});
  } catch (error) {
    // ホスト権限が無いと、この fetch も通常の Web ページと同じ CORS の対象になり、
    // Access-Control-Allow-Origin を返さない配信元では TypeError で落ちる。
    // 権限はポップアップが送信時に要求するが、その後で失効した場合にここへ来る。
    const host = new URL(image.value).host;
    throw new Error(`${host} の画像を取得できませんでした（読み取り許可の確認が必要）: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`画像を取得できませんでした (HTTP ${response.status}): ${image.value}`);
  }
  return response.blob();
}

async function save(input) {
  const formData = new FormData();
  formData.set('title', input.title);
  formData.set('url', input.url);
  formData.set('rating', String(input.rating ?? 0));
  formData.set('sort_order', String(input.sortOrder ?? 0));
  formData.set('tags', input.tags.join(','));

  for (const [index, image] of input.images.entries()) {
    const blob = await toBlob(image);
    const extension = EXTENSION_BY_TYPE[blob.type] ?? '.jpg';
    formData.append('thumbnails', blob, `thumbnail-${index + 1}${extension}`);
  }

  return authorizedFetch('/api/bookmarks', {method: 'POST', body: formData});
}

/** メッセージの種類ごとの処理。戻り値はそのままポップアップへ返す。 */
const handlers = {
  async getState() {
    const [settings, session] = await Promise.all([loadSettings(), getSession()]);
    const {[DRAFT_KEY]: draft} = await chrome.storage.local.get(DRAFT_KEY);
    return {
      configured: isConfigured(settings),
      email: session?.email ?? null,
      signedIn: Boolean(session),
      draft: draft ?? null,
    };
  },

  async signIn({email, password}) {
    const session = await signIn(email, password);
    return {email: session.email};
  },

  async signOut() {
    await signOut();
    return {};
  },

  async getTags() {
    return authorizedFetch('/api/tags');
  },

  async lookup({url}) {
    return authorizedFetch(`/api/bookmarks/lookup?url=${encodeURIComponent(url)}`);
  },

  async save(input) {
    const result = await save(input);
    // 送信できたので、失敗時に残した下書きは捨てる。
    await chrome.storage.local.remove(DRAFT_KEY);
    return result;
  },

  async saveDraft(draft) {
    await chrome.storage.local.set({[DRAFT_KEY]: draft});
    return {};
  },

  async clearDraft() {
    await chrome.storage.local.remove(DRAFT_KEY);
    return {};
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ok: false, error: `不明な要求: ${message?.type}`});
    return false;
  }

  handler(message.payload ?? {})
    .then((data) => sendResponse({ok: true, data}))
    .catch((error) => sendResponse({ok: false, error: error.message}));

  // 非同期で応答するため、チャネルを開いたままにする。
  return true;
});
