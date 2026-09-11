// ポップアップ。候補の提示と入力を受け持つ。
// 認証と送信は service worker（background.js）に任せ、ここではアクセストークンを扱わない。

import {collectPageInfo, freezeVideoAt, grabVideoFrames, restoreVideo} from './page.js';

/** app/utils/bookmarks.ts の MAX_THUMBNAILS と同じ値にする。 */
const MAX_THUMBNAILS = 10;

/** ページから集める候補の上限。選べる枚数より多めに出して、選ぶ余地を作る。 */
const MAX_CANDIDATES = 12;

/** 動画から抜く枚数。canvas 経路はシークするだけなので多めに取れる。 */
const FRAME_COUNT = 6;

/** 画面キャプチャ経路の枚数。captureVisibleTab は毎秒2回までの制限があるため控えめにする。 */
const CAPTURE_COUNT = 4;

/** 同じ制限に合わせたキャプチャ間隔。 */
const CAPTURE_INTERVAL_MS = 550;

/** 抜いた静止画の長辺の上限。送信量を抑える。 */
const FRAME_MAX_EDGE = 1280;

const state = {
  tab: null,
  /** @type {{id: string, kind: 'url' | 'dataUrl', value: string, origin: string}[]} */
  candidates: [],
  /** 選んだ候補の id。並び順がサムネイルの並び順になる。 */
  selected: [],
  tags: [],
  suggestions: [],
  rating: 0,
  highlighted: 0,
};

const element = (id) => document.getElementById(id);

function show(viewId) {
  for (const id of ['view-unconfigured', 'view-login', 'view-form']) {
    element(id).hidden = id !== viewId;
  }
}

function setNotice(id, message) {
  const node = element(id);
  node.textContent = message ?? '';
  node.hidden = !message;
}

/** service worker への問い合わせ。失敗は例外にして呼び出し側で拾う。 */
async function send(type, payload) {
  const response = await chrome.runtime.sendMessage({type, payload});
  if (!response?.ok) {
    throw new Error(response?.error ?? '拡張の内部処理に失敗しました');
  }
  return response.data;
}

/** ページの中で関数を動かす。埋め込み動画も対象にしたいので全フレームに注入する。 */
async function runInPage(func, args = []) {
  return chrome.scripting.executeScript({
    target: {tabId: state.tab.id, allFrames: true},
    func,
    args,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- 評価 -------------------------------------------------------------------

function renderRating() {
  const box = element('rating');
  box.textContent = '';

  for (let position = 1; position <= 5; position += 1) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star';
    star.setAttribute('aria-label', `${position} 点`);

    const base = document.createElement('span');
    base.textContent = '★';

    const fill = document.createElement('span');
    fill.className = 'fill';
    fill.textContent = '★';
    // 0.5 刻みの入力なので、塗りは 0% / 50% / 100% のいずれかになる。
    fill.style.width = `${Math.min(1, Math.max(0, state.rating - (position - 1))) * 100}%`;

    star.append(base, fill);
    star.addEventListener('click', (event) => {
      const rect = star.getBoundingClientRect();
      const isLeftHalf = event.clientX - rect.left < rect.width / 2;
      const value = position - (isLeftHalf ? 0.5 : 0);
      // 同じ値をもう一度押したら未評価に戻す。未評価は送信時に null として扱う。
      state.rating = state.rating === value ? 0 : value;
      renderRating();
    });

    box.append(star);
  }
}

// --- タグ -------------------------------------------------------------------

function renderTags() {
  const box = element('tag-box');
  const input = element('tag-input');

  for (const chip of box.querySelectorAll('.chip')) {
    chip.remove();
  }

  for (const tag of state.tags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `タグ「${tag}」を外す`);
    remove.addEventListener('click', () => {
      state.tags = state.tags.filter((name) => name !== tag);
      renderTags();
      input.focus();
    });

    chip.append(remove);
    box.insertBefore(chip, input);
  }

  element('tag-count').textContent = state.tags.length > 0 ? String(state.tags.length) : '';
}

/** 入力中の文字列に対する候補。既に付けたタグは出さない。末尾に新規作成の行を足す。 */
function tagOptions() {
  const query = element('tag-input').value.trim().toLowerCase();
  const chosen = new Set(state.tags.map((tag) => tag.toLowerCase()));

  const existing = state.suggestions
    .filter((name) => !chosen.has(name.toLowerCase()))
    .filter((name) => query === '' || name.toLowerCase().includes(query))
    .slice(0, 8)
    .map((name) => ({kind: 'existing', value: name}));

  const isKnown = [...state.suggestions, ...state.tags].some(
    (name) => name.toLowerCase() === query,
  );

  return query !== '' && !isKnown
    ? [...existing, {kind: 'create', value: element('tag-input').value.trim()}]
    : existing;
}

function renderSuggestions() {
  const list = element('tag-suggestions');
  const options = tagOptions();
  list.textContent = '';
  list.hidden = options.length === 0;

  if (state.highlighted >= options.length) {
    state.highlighted = 0;
  }

  options.forEach((option, index) => {
    const row = document.createElement('li');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === state.highlighted));

    const label = document.createElement('span');
    label.textContent = option.value;

    const kind = document.createElement('span');
    kind.className = 'kicker';
    kind.textContent = option.kind === 'create' ? 'New' : 'Tag';

    row.append(label, kind);
    row.addEventListener('mousedown', (event) => {
      // 既定動作で入力欄がフォーカスを失うのを防ぐ。
      event.preventDefault();
      commitTag(option.value);
    });
    list.append(row);
  });
}

function commitTag(value) {
  const tag = value.trim();
  if (tag === '') {
    return;
  }
  if (!state.tags.some((name) => name.toLowerCase() === tag.toLowerCase())) {
    state.tags.push(tag);
  }
  element('tag-input').value = '';
  state.highlighted = 0;
  renderTags();
  renderSuggestions();
}

function setUpTagInput() {
  const input = element('tag-input');

  input.addEventListener('input', () => {
    state.highlighted = 0;
    renderSuggestions();
  });

  input.addEventListener('keydown', (event) => {
    // 日本語入力の変換確定でも Enter が飛ぶため、変換中のキーはタグ確定として扱わない。
    if (event.isComposing) {
      return;
    }

    const options = tagOptions();

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        state.highlighted = (state.highlighted + step + options.length) % options.length;
        renderSuggestions();
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ',') {
      const picked = options[state.highlighted]?.value ?? input.value.trim();
      if (picked !== '') {
        event.preventDefault();
        commitTag(picked);
      }
      return;
    }

    if (event.key === 'Backspace' && input.value === '' && state.tags.length > 0) {
      event.preventDefault();
      state.tags.pop();
      renderTags();
      renderSuggestions();
    }
  });
}

// --- サムネイル候補 ---------------------------------------------------------

function renderThumbs() {
  const box = element('thumbs');
  box.textContent = '';

  for (const candidate of state.candidates) {
    const order = state.selected.indexOf(candidate.id);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb';
    button.setAttribute('aria-pressed', String(order >= 0));

    const image = document.createElement('img');
    image.src = candidate.value;
    image.alt = '';
    image.loading = 'lazy';
    // 読み込めない候補（403 や失効した URL）は選ばせない。
    image.addEventListener('error', () => {
      state.candidates = state.candidates.filter((entry) => entry.id !== candidate.id);
      state.selected = state.selected.filter((id) => id !== candidate.id);
      renderThumbs();
    });

    const origin = document.createElement('span');
    origin.className = 'origin';
    origin.textContent = candidate.origin;

    button.append(image, origin);

    if (order >= 0) {
      const badge = document.createElement('span');
      badge.className = 'order';
      badge.textContent = String(order + 1);
      button.append(badge);
    }

    button.addEventListener('click', () => toggleThumb(candidate.id));
    box.append(button);
  }

  element('thumb-count').textContent =
    state.selected.length > 0 ? `${state.selected.length} / ${MAX_THUMBNAILS}` : '';
}

function toggleThumb(id) {
  if (state.selected.includes(id)) {
    state.selected = state.selected.filter((selectedId) => selectedId !== id);
  } else if (state.selected.length >= MAX_THUMBNAILS) {
    setNotice('form-error', `サムネイルは${MAX_THUMBNAILS}枚までです`);
    return;
  } else {
    state.selected.push(id);
  }
  setNotice('form-error', '');
  renderThumbs();
  void updateImageAccessPrompt();
}

/**
 * 選んだ画像を取得するために、どのホストの権限が足りていないかを返す。
 *
 * 画像は拡張が URL から取得し直して送るため、そのホストの権限が要る。権限が無いと
 * service worker の fetch も通常の Web ページと同じ CORS の対象になり、
 * Access-Control-Allow-Origin を返さない配信元では必ず失敗する。
 * 動画から抜いた静止画は拡張の中で作ったデータなので、この権限を必要としない。
 */
function selectedImageOrigins() {
  const origins = new Set();

  for (const candidate of state.candidates) {
    if (!state.selected.includes(candidate.id) || candidate.kind !== 'url') {
      continue;
    }
    try {
      origins.add(`${new URL(candidate.value).origin}/*`);
    } catch {
      // URL として読めない候補は送信時にどのみち失敗するので、権限の判定からは外す。
    }
  }

  return [...origins];
}

async function missingImageOrigins() {
  const origins = selectedImageOrigins();
  const missing = [];
  for (const origin of origins) {
    if (!(await chrome.permissions.contains({origins: [origin]}))) {
      missing.push(origin);
    }
  }
  return missing;
}

/** 足りない権限があるときだけ、許可を求めるボタンを出す。 */
async function updateImageAccessPrompt() {
  const missing = await missingImageOrigins();
  const button = element('grant-images');

  button.hidden = missing.length === 0;
  button.textContent =
    missing.length === 1
      ? `${new URL(missing[0].replace(/\/\*$/, '')).host} の画像取得を許可`
      : `${missing.length} 件のサイトの画像取得を許可`;
}

function addCandidates(entries) {
  for (const entry of entries) {
    if (state.candidates.some((candidate) => candidate.value === entry.value)) {
      continue;
    }
    state.candidates.push({id: crypto.randomUUID(), ...entry});
  }
}

// --- 既にある可能性のあるブックマーク ---------------------------------------

/** 一致の近さの表示名。 */
const MATCH_LABEL = {exact: '完全一致', prefix: '前方一致'};

/**
 * URL で書架を検索し、同じ対象を指していそうなブックマークを出す。
 *
 * 前方一致も出すのは、クエリ違いや下層ページで URL が揺れても同じ商品・同じページを
 * 二重に納めないようにするため。**登録は止めない**（別物である場合があるので、
 * 同じものかどうかの判断は利用者に任せる）。
 *
 * @returns 正規化した URL。検索に失敗したときは null。
 */
async function searchArchive(url) {
  const box = element('duplicate');
  const list = element('duplicate-list');

  try {
    const {normalizedUrl, matches} = await send('lookup', {url});

    list.textContent = '';
    box.hidden = matches.length === 0;

    if (matches.length > 0) {
      element('duplicate-head').textContent =
        `書架に近いブックマークが ${matches.length} 件あります。このまま追加すると別の1件になります。`;

      for (const match of matches) {
        const row = document.createElement('li');

        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = `#${match.id} ${match.title ?? '無題'}`;

        const how = document.createElement('span');
        how.className = 'how';
        how.textContent = ` ${MATCH_LABEL[match.match]}`;

        const link = document.createElement('span');
        link.className = 'url';
        link.textContent = match.url;

        title.append(how);
        row.append(title, link);
        list.append(row);
      }
    }

    return normalizedUrl;
  } catch (error) {
    setNotice('form-error', error.message);
    return null;
  }
}

// --- 動画から静止画を抜く ---------------------------------------------------

async function grabFrames() {
  const button = element('grab-frames');
  button.disabled = true;
  setNotice('thumb-status', '動画から静止画を抜いています…');

  try {
    const results = await runInPage(grabVideoFrames, [FRAME_COUNT, FRAME_MAX_EDGE]);
    const outcome = results.map((result) => result.result).find((value) => value && value.kind !== 'none');

    if (!outcome) {
      setNotice('thumb-status', '再生できる動画が見つかりませんでした。');
      return;
    }

    if (outcome.kind === 'frames') {
      addFrames(outcome.frames);
      setNotice('thumb-status', `${outcome.frames.length} 枚を候補に追加しました。`);
      return;
    }

    // canvas から読み出せない動画は、画面に映っているものをそのまま撮る。
    setNotice('thumb-status', '動画を直接読み出せないため、画面キャプチャに切り替えます…');
    const frames = await grabFramesByCapture();
    if (frames.length === 0) {
      setNotice('thumb-status', '画面キャプチャでも取得できませんでした。手元の画像を使ってください。');
      return;
    }
    addFrames(frames);
    setNotice('thumb-status', `画面キャプチャで ${frames.length} 枚を候補に追加しました。`);
  } catch (error) {
    setNotice('thumb-status', `静止画を抜けませんでした: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function addFrames(dataUrls) {
  addCandidates(dataUrls.map((dataUrl) => ({kind: 'dataUrl', value: dataUrl, origin: 'frame'})));
  renderThumbs();
}

/**
 * 画面キャプチャで静止画を集める。動画を止める → 撮る → 次の位置へ、を繰り返す。
 * 撮影の間隔を空けているのは captureVisibleTab が毎秒2回までに制限されているため。
 */
async function grabFramesByCapture() {
  const frames = [];
  let firstState = null;

  for (let index = 0; index < CAPTURE_COUNT; index += 1) {
    const results = await runInPage(freezeVideoAt, [(index + 0.5) / CAPTURE_COUNT]);
    const frozen = results.map((result) => result.result).find(Boolean);
    if (!frozen) {
      break;
    }
    // 戻す先は最初に止めた位置。2回目以降の previousTime は自分が動かした位置になる。
    firstState ??= frozen.state;

    const shot = await chrome.tabs.captureVisibleTab(state.tab.windowId, {
      format: 'jpeg',
      quality: 85,
    });
    frames.push(await cropToVideo(shot, frozen.rect, frozen.devicePixelRatio));

    if (index < CAPTURE_COUNT - 1) {
      await sleep(CAPTURE_INTERVAL_MS);
    }
  }

  if (firstState) {
    await runInPage(restoreVideo, [firstState]);
  }

  return frames;
}

/** 画面全体のキャプチャから動画の矩形だけを切り出す。 */
async function cropToVideo(dataUrl, rect, devicePixelRatio) {
  const shot = new Image();
  await new Promise((resolve, reject) => {
    shot.addEventListener('load', resolve);
    shot.addEventListener('error', () => reject(new Error('キャプチャを読み込めませんでした')));
    shot.src = dataUrl;
  });

  // キャプチャの画素は CSS ピクセル × devicePixelRatio。はみ出しは画像の範囲に丸める。
  const left = Math.max(0, Math.round(rect.x * devicePixelRatio));
  const top = Math.max(0, Math.round(rect.y * devicePixelRatio));
  const width = Math.min(shot.width - left, Math.round(rect.width * devicePixelRatio));
  const height = Math.min(shot.height - top, Math.round(rect.height * devicePixelRatio));

  if (width <= 0 || height <= 0) {
    return dataUrl;
  }

  const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas
    .getContext('2d')
    .drawImage(shot, left, top, width, height, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', 0.85);
}

// --- 画面の組み立て ---------------------------------------------------------

async function setUpForm(draft) {
  show('view-form');
  renderRating();
  renderTags();
  setUpTagInput();

  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  state.tab = tab;

  element('title').value = tab.title ?? '';
  element('url').value = tab.url ?? '';

  // ページの中身を読む。chrome:// や拡張の管理画面では注入できない。
  try {
    const results = await runInPage(collectPageInfo, [MAX_CANDIDATES]);
    const top = results.find((result) => result.frameId === 0)?.result;

    if (top) {
      element('title').value = top.title || tab.title || '';
      element('grab-frames').hidden = !results.some((result) => result.result?.hasVideo);
    }

    for (const result of results) {
      addCandidates(
        (result.result?.candidates ?? []).map((candidate) => ({
          kind: 'url',
          value: candidate.url,
          origin: candidate.source,
        })),
      );
    }
    state.candidates = state.candidates.slice(0, MAX_CANDIDATES);
    renderThumbs();
  } catch (error) {
    setNotice('thumb-status', `このページからは画像を集められません: ${error.message}`);
  }

  // 書架を検索し、URL 欄には計測パラメータを落とした形を入れる。
  const normalizedUrl = await searchArchive(tab.url);
  if (normalizedUrl) {
    element('url').value = normalizedUrl;
  }

  // URL を手で直したら、その URL でもう一度検索する。
  // 入力の途中では走らせたくないので、確定（change）のときだけにする。
  element('url').addEventListener('change', () => {
    void searchArchive(element('url').value.trim());
  });

  try {
    const {tags} = await send('getTags');
    state.suggestions = tags;
  } catch (error) {
    // 候補が出ないだけで登録自体は続けられるため、ここでは止めない。
    setNotice('thumb-status', `タグ候補を取得できませんでした: ${error.message}`);
  }

  if (draft && draft.url === element('url').value) {
    restoreDraft(draft);
  }

  await updateImageAccessPrompt();
}

function restoreDraft(draft) {
  element('title').value = draft.title;
  element('sort-order').value = draft.sortOrder || '';
  state.tags = draft.tags;
  state.rating = draft.rating ?? 0;

  addCandidates(draft.images.map((image) => ({...image, origin: 'draft'})));
  state.selected = state.candidates
    .filter((candidate) => draft.images.some((image) => image.value === candidate.value))
    .map((candidate) => candidate.id);

  renderRating();
  renderTags();
  renderThumbs();
  setNotice('thumb-status', '送信に失敗した下書きを戻しました。');
}

async function submit(event) {
  event.preventDefault();
  setNotice('form-error', '');

  const payload = {
    title: element('title').value.trim(),
    url: element('url').value.trim(),
    rating: state.rating || null,
    sortOrder: Number(element('sort-order').value) || 0,
    tags: state.tags,
    images: state.selected.map((id) => {
      const candidate = state.candidates.find((entry) => entry.id === id);
      return {kind: candidate.kind, value: candidate.value};
    }),
  };

  // 権限ダイアログでポップアップが閉じても入力を失わないよう、先に下書きを残す。
  // await すると次の permissions.request が利用者の操作の外になるため、待たない。
  void send('saveDraft', payload);

  // 選んだ画像のホストの権限をここで要求する。permissions.request は利用者の操作の中から
  // しか呼べないので、await を挟む前に呼ぶ。既に持っている権限なら確認は出ず true が返る。
  const origins = selectedImageOrigins();

  if (origins.length > 0 && !(await chrome.permissions.request({origins}))) {
    setNotice(
      'form-error',
      '画像の取得が許可されなかったため送信できません。画像の選択を外すか、許可してください。',
    );
    await updateImageAccessPrompt();
    return;
  }

  const button = element('submit');
  button.disabled = true;
  button.textContent = '保存中';

  try {
    await send('save', payload);
    element('view-form').hidden = true;
    setNotice('form-done', '納めました。');
    element('form-done').hidden = false;
    // 納めたことが読める程度の間を置いて閉じる。
    await sleep(900);
    window.close();
  } catch (error) {
    setNotice('form-error', error.message);
    // 入力を捨てずに残す。次に同じページで開いたときに戻す。
    await send('saveDraft', payload);
  } finally {
    button.disabled = false;
    button.textContent = '追加する';
  }
}

async function signIn(event) {
  event.preventDefault();
  setNotice('login-error', '');

  try {
    await send('signIn', {
      email: element('email').value,
      password: element('password').value,
    });
    await setUpForm(null);
  } catch (error) {
    setNotice('login-error', error.message);
  }
}

async function main() {
  element('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  element('to-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  element('view-login').addEventListener('submit', signIn);
  element('view-form').addEventListener('submit', submit);
  element('grab-frames').addEventListener('click', grabFrames);

  element('sign-out').addEventListener('click', async () => {
    await send('signOut');
    show('view-login');
  });

  // permissions.request は利用者の操作の中からしか呼べないため、ボタンの click で呼ぶ。
  // https://developer.chrome.com/docs/extensions/reference/api/permissions
  element('grant-images').addEventListener('click', async () => {
    const origins = selectedImageOrigins();
    if (origins.length > 0) {
      await chrome.permissions.request({origins});
    }
    await updateImageAccessPrompt();
  });

  const {configured, signedIn, draft} = await send('getState');

  if (!configured) {
    show('view-unconfigured');
    return;
  }
  if (!signedIn) {
    show('view-login');
    return;
  }
  await setUpForm(draft);
}

void main();
