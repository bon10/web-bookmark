// 設定画面。接続先の入力と、そこへ通信するためのホスト権限の取得を行う。

import {hasImageAccess, loadSettings, saveSettings} from './settings.js';

const element = (id) => document.getElementById(id);

function setMessage(text, isError) {
  const node = element('message');
  node.textContent = text;
  node.className = isError ? 'notice error' : 'notice done';
  node.hidden = !text;
}

/** URL からホスト権限のパターン（<scheme>://<host>/*）を作る。 */
function toOriginPattern(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.host}/*`;
}

async function refreshImageAccess() {
  element('image-access').textContent = (await hasImageAccess()) ? '許可済み' : '未許可';
}

async function save(event) {
  event.preventDefault();

  const settings = {
    appBaseUrl: element('app-base-url').value.trim(),
    supabaseUrl: element('supabase-url').value.trim(),
    supabasePublishableKey: element('supabase-key').value.trim(),
  };

  let origins;
  try {
    origins = [toOriginPattern(settings.appBaseUrl), toOriginPattern(settings.supabaseUrl)];
  } catch {
    setMessage('URL の形式が正しくありません。', true);
    return;
  }

  // アプリと Supabase へは service worker から fetch するため、そのホストの権限が要る。
  // permissions.request は利用者の操作の中からしか呼べないので、保存ボタンの中で呼ぶ。
  // https://developer.chrome.com/docs/extensions/reference/api/permissions
  let granted = false;
  try {
    granted = await chrome.permissions.request({origins});
  } catch (error) {
    setMessage(`権限を要求できませんでした: ${error.message}`, true);
    return;
  }

  if (!granted) {
    setMessage('接続先への権限が許可されなかったため、通信できません。', true);
    return;
  }

  await saveSettings(settings);
  setMessage('保存しました。ポップアップからログインしてください。', false);
}

async function main() {
  const settings = await loadSettings();
  element('app-base-url').value = settings.appBaseUrl;
  element('supabase-url').value = settings.supabaseUrl;
  element('supabase-key').value = settings.supabasePublishableKey;

  element('settings').addEventListener('submit', save);
  element('grant-images').addEventListener('click', async () => {
    await chrome.permissions.request({origins: ['https://*/*', 'http://*/*']});
    await refreshImageAccess();
  });

  await refreshImageAccess();
}

void main();
