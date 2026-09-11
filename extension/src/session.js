// Supabase のセッションを拡張側で保持する。
//
// 画面（Next.js アプリ）は Cookie でセッションを持つが、拡張は別オリジンで動くため
// Cookie を共有できない。そこで拡張は自分でログインし、アクセストークンとリフレッシュ
// トークンを chrome.storage.local に置く。
//
// トークンは content script に渡さない。content script は注入先ページと DOM を共有するので、
// ページ側のスクリプトから触れる場所にトークンを置かないため、通信はこのモジュールを
// 呼ぶ service worker だけが行う。
//
// 叩いている口は @supabase/auth-js 2.116.0（アプリが使っている版）の実装に合わせた。
//   ログイン: POST {supabaseUrl}/auth/v1/token?grant_type=password  body {email, password}
//   更新:     POST {supabaseUrl}/auth/v1/token?grant_type=refresh_token  body {refresh_token}
// publishable key は apikey ヘッダーにだけ載せる。新形式のキー（sb_publishable_…）は
// JWT ではないため Bearer として送ってはいけない、と supabase-js 側に明記されている。

import {loadSettings} from './settings.js';

const SESSION_KEY = 'session';

/** 期限の何秒前から更新を試みるか。通信の往復と時計のずれを見込む。 */
const REFRESH_MARGIN_SECONDS = 60;

async function authFetch(path, body) {
  const settings = await loadSettings();
  const response = await fetch(`${settings.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: settings.supabasePublishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    // GoTrue はエラーの文面を error_description / msg / message のいずれかで返す。
    const message =
      payload?.error_description ?? payload?.msg ?? payload?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function toSession(payload) {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    // expires_at は秒。返らない場合は expires_in から自分で組む。
    expiresAt: payload.expires_at ?? Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600),
    email: payload.user?.email ?? '',
  };
}

export async function signIn(email, password) {
  const session = toSession(await authFetch('token?grant_type=password', {email, password}));
  await chrome.storage.local.set({[SESSION_KEY]: session});
  return session;
}

export async function signOut() {
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function getSession() {
  const {[SESSION_KEY]: session} = await chrome.storage.local.get(SESSION_KEY);
  return session ?? null;
}

/**
 * 有効なアクセストークンを返す。期限が近ければリフレッシュトークンで取り直す。
 * 取り直しに失敗したときはセッションを捨てて null を返す（再ログインを促すため）。
 */
export async function getAccessToken() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const stillValid = session.expiresAt - REFRESH_MARGIN_SECONDS > Math.floor(Date.now() / 1000);
  if (stillValid) {
    return session.accessToken;
  }

  try {
    const refreshed = toSession(
      await authFetch('token?grant_type=refresh_token', {refresh_token: session.refreshToken}),
    );
    await chrome.storage.local.set({[SESSION_KEY]: refreshed});
    return refreshed.accessToken;
  } catch {
    await signOut();
    return null;
  }
}
