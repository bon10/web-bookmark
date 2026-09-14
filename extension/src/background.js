// service worker。ログインとサーバーへの送信はすべてここで行う。
//
// ポップアップではなくここに寄せている理由は2つ。
//   1. アクセストークンを content script から遠ざける（ページ側に漏らさない）
//   2. service worker の fetch だけが host_permissions によって自オリジン外へ出られる
//      （content script の fetch は注入先ページのオリジン扱いで CORS に阻まれる）
//      https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

import {loadSettings, isConfigured} from './settings.js';
import {getAccessToken, getSession, signIn, signOut} from './session.js';

/**
 * 入力途中の内容（下書き）の置き場。
 *
 * ポップアップはタブやウィンドウを切り替えると閉じられ、その時点で画面の状態は消える。
 * タグや評価を入れ直す手間を無くすため、入力のたびにここへ写しておき、同じページで
 * 開き直したときに戻す。鍵はページの正規化した URL。
 */
const DRAFTS_KEY = 'drafts';

/** 残す下書きの件数。複数のページを行き来しても直近のものが残る程度に持つ。 */
const MAX_DRAFTS = 5;

/** 下書きを残す期間。これより古いものは、開き直しても戻さず捨てる。 */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function loadDrafts() {
  const {[DRAFTS_KEY]: drafts} = await chrome.storage.local.get(DRAFTS_KEY);
  return drafts ?? {};
}

/** 古いものと溢れた分を落としてから書き戻す。 */
async function storeDrafts(drafts) {
  const fresh = Object.entries(drafts)
    .filter(([, draft]) => Date.now() - draft.savedAt < DRAFT_TTL_MS)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_DRAFTS);

  await chrome.storage.local.set({[DRAFTS_KEY]: Object.fromEntries(fresh)});
}

/**
 * 画像形式の判定に使う先頭バイトの並び。
 *
 * 配信元の Content-Type は信用しない。`application/octet-stream` や `image/jpg` のような
 * 非標準の値を返すサーバーがあり、それをそのまま送るとアプリ側の形式チェックで弾かれる。
 * 中身を見て決めれば、配信元の申告が何であっても正しい形式と拡張子で送れる。
 */
const SIGNATURES = [
  {
    type: 'image/jpeg',
    extension: '.jpg',
    matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    type: 'image/png',
    extension: '.png',
    matches: (bytes) =>
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
  {
    type: 'image/gif',
    extension: '.gif',
    matches: (bytes) => bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46,
  },
  {
    type: 'image/webp',
    extension: '.webp',
    matches: (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP',
  },
  {
    type: 'image/avif',
    extension: '.avif',
    // ISO BMFF の ftyp ボックス。先頭4バイトはボックスサイズなので 4 バイト目から見る。
    matches: (bytes) =>
      ascii(bytes, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 4)),
  },
];

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

/**
 * アプリが受け取れる形式に揃える。
 *
 * 先頭バイトで形式が分かればその形式として送る。分からない形式（BMP や、画像ではない
 * 応答など）は、デコードできる限り JPEG に変換して送る。変換もできないものは
 * 形式名を添えて失敗させる（SVG は service worker で createImageBitmap が使えないため
 * ここに来る）。
 */
async function normalizeImage(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const signature = SIGNATURES.find((candidate) => candidate.matches(bytes));

  if (signature) {
    // 申告された type は捨て、判定した type で包み直す。
    return {blob: new Blob([blob], {type: signature.type}), extension: signature.extension};
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const converted = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.9});
    return {blob: converted, extension: '.jpg'};
  } catch (error) {
    throw new Error(
      `対応していない画像形式です（${blob.type || '形式不明'}、JPEG への変換も失敗: ${error.message}）`,
    );
  }
}

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
    const {blob, extension} = await normalizeImage(await toBlob(image));
    formData.append('thumbnails', blob, `thumbnail-${index + 1}${extension}`);
  }

  return authorizedFetch('/api/bookmarks', {method: 'POST', body: formData});
}

/** メッセージの種類ごとの処理。戻り値はそのままポップアップへ返す。 */
const handlers = {
  async getState() {
    const [settings, session] = await Promise.all([loadSettings(), getSession()]);
    return {
      configured: isConfigured(settings),
      email: session?.email ?? null,
      signedIn: Boolean(session),
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
    // 納まったので、このページの下書きは役目を終える。
    const drafts = await loadDrafts();
    delete drafts[input.key];
    await storeDrafts(drafts);
    return result;
  },

  async saveDraft({key, draft}) {
    const drafts = await loadDrafts();
    drafts[key] = {...draft, savedAt: Date.now()};
    await storeDrafts(drafts);
    return {};
  },

  async loadDraft({key}) {
    const drafts = await loadDrafts();
    const draft = drafts[key];
    // 期限切れは無いものとして扱う（掃除は次の書き込みに任せる）。
    return draft && Date.now() - draft.savedAt < DRAFT_TTL_MS ? draft : null;
  },

  async clearDraft({key}) {
    const drafts = await loadDrafts();
    delete drafts[key];
    await storeDrafts(drafts);
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
