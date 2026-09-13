// ページの中で実行する関数を集めたモジュール。
//
// ここの関数は chrome.scripting.executeScript の func として渡す。func は文字列化して
// ページへ送られるため、**外側の変数・import・他の関数を一切参照できない**
// （「This function will be serialized, and then deserialized for injection.
//   This means that any bound parameters and execution context will be lost.」
//   https://developer.chrome.com/docs/extensions/reference/api/scripting）。
// そのため各関数は単体で完結させ、共通処理を外に出していない。値の受け渡しは args で行う。
//
// 非同期の関数を渡してよいことも同じドキュメントで保証されている
// （「If the script evaluates to a promise, the browser will wait for the promise to settle」）。

/**
 * ページの表題と画像候補を集める。
 *
 * 候補の出どころは4つ。ページが自分で代表として掲げている画像（og:image 等）を先頭に置き、
 * 残りは面積の大きい順に並べる。小さい画像はアイコンや計測用の 1px 画素なので落とす。
 *
 * @param {number} maxCandidates 返す候補の上限。
 */
export function collectPageInfo(maxCandidates) {
  const MIN_EDGE = 160;
  const SCAN_LIMIT = 1500;

  const seen = new Set();
  /** @type {{url: string, width: number, height: number, source: string}[]} */
  const meta = [];
  /** @type {{url: string, width: number, height: number, source: string}[]} */
  const rest = [];

  function push(bucket, rawUrl, width, height, source) {
    if (!rawUrl) {
      return;
    }
    let absolute;
    try {
      absolute = new URL(rawUrl, location.href).href;
    } catch {
      return;
    }
    // data: と blob: は拡張側から取得し直せないため候補にしない。
    if (!absolute.startsWith('http://') && !absolute.startsWith('https://')) {
      return;
    }
    if (seen.has(absolute)) {
      return;
    }
    seen.add(absolute);
    bucket.push({url: absolute, width, height, source});
  }

  // 1. ページが代表として掲げている画像。寸法は分からないので 0 を入れる。
  for (const selector of [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'link[rel="image_src"]',
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      push(meta, element.getAttribute('content') ?? element.getAttribute('href'), 0, 0, 'meta');
    }
  }

  // 2. video の poster。動画ページでは本文の img より中身を表している。
  for (const video of document.querySelectorAll('video[poster]')) {
    push(meta, video.getAttribute('poster'), video.videoWidth, video.videoHeight, 'poster');
  }

  // 3. img 要素。currentSrc は srcset と <picture> の選択結果が入るので、これを優先する。
  for (const image of document.querySelectorAll('img')) {
    const width = image.naturalWidth || image.clientWidth;
    const height = image.naturalHeight || image.clientHeight;

    // 未読み込みの遅延読み込み画像は寸法が 0 になる。落とさず候補に入れる。
    const isUnloaded = width === 0 && height === 0;
    if (!isUnloaded && (width < MIN_EDGE || height < MIN_EDGE)) {
      continue;
    }

    push(rest, image.currentSrc || image.src, width, height, 'img');

    for (const attribute of ['data-src', 'data-original', 'data-lazy-src']) {
      push(rest, image.getAttribute(attribute), width, height, 'lazy');
    }
  }

  // 4. CSS の背景画像。全要素に getComputedStyle を掛けると重いので、
  //    十分な大きさで描かれている要素だけに絞り、走査数にも上限を置く。
  const elements = document.querySelectorAll('*');
  for (let index = 0; index < Math.min(elements.length, SCAN_LIMIT); index += 1) {
    const element = elements[index];
    const rect = element.getBoundingClientRect();
    if (rect.width < MIN_EDGE || rect.height < MIN_EDGE) {
      continue;
    }
    const background = getComputedStyle(element).backgroundImage;
    if (!background || background === 'none') {
      continue;
    }
    for (const match of background.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
      push(rest, match[2], Math.round(rect.width), Math.round(rect.height), 'background');
    }
  }

  rest.sort((a, b) => b.width * b.height - a.width * a.height);

  return {
    title: (document.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
      document.title ??
      '').trim(),
    url: location.href,
    hasVideo: document.querySelectorAll('video').length > 0,
    candidates: [...meta, ...rest].slice(0, maxCandidates),
  };
}

/**
 * ページ内の動画から静止画を抜く。
 *
 * 戻り値の kind で呼び出し元の次の手が変わる。
 *   frames  … 抜けた。frames に data URL が入る
 *   tainted … 別オリジンの動画で canvas が汚染され読み出せない。画面キャプチャに切り替える
 *   none    … 再生可能な video が無い
 *
 * 再生位置は抜き終わったあと元に戻す（利用者の再生を巻き戻したままにしないため）。
 *
 * @param {number} count 抜く枚数。
 * @param {number} maxEdge 書き出す画像の長辺の上限（送信量を抑えるため）。
 */
export async function grabVideoFrames(count, maxEdge) {
  const videos = [...document.querySelectorAll('video')]
    .filter((video) => video.videoWidth > 0 && video.readyState >= 2)
    .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);

  const video = videos[0];
  if (!video) {
    return {kind: 'none'};
  }

  const previousTime = video.currentTime;
  const wasPlaying = !video.paused;
  video.pause();

  function seek(time) {
    return new Promise((resolve) => {
      // seeked が来ない実装に当たっても止まらないよう、待ち時間に上限を置く。
      const timer = setTimeout(finish, 1500);
      function finish() {
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        resolve();
      }
      video.addEventListener('seeked', finish);
      video.currentTime = time;
    });
  }

  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');

  // 生放送などで長さが取れないときは、いま映っている1枚だけを相手にする。
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const times = [];
  if (duration === 0) {
    times.push(previousTime);
  } else {
    // 冒頭と末尾は黒画面やロゴになりやすいので、3%〜97% の範囲から選ぶ。
    //
    // 位置は実行のたびに変える。等間隔に固定すると、そこが暗転や字幕だけの場面だったときに
    // 何度押しても同じ絵しか出てこないため。ただし完全な無作為だと数枚が同じ場面に
    // 固まることがあるので、範囲を枚数分の区間に割り、各区間から1点ずつ選ぶ。
    // 区間の端は避ける（隣の区間と隣接した位置を選んでしまい、ほぼ同じ絵になるのを防ぐ）。
    for (let index = 0; index < count; index += 1) {
      const position = (index + 0.1 + 0.8 * Math.random()) / count;
      times.push(duration * (0.03 + 0.94 * position));
    }
  }

  const frames = [];
  let tainted = false;

  for (const time of times) {
    if (duration > 0) {
      await seek(time);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      frames.push(canvas.toDataURL('image/jpeg', 0.85));
    } catch {
      // 別オリジンの動画を描いた canvas は読み出せない（SecurityError）。
      tainted = true;
      break;
    }
  }

  if (duration > 0) {
    await seek(previousTime);
  }
  if (wasPlaying) {
    video.play().catch(() => {});
  }

  if (tainted) {
    return {kind: 'tainted'};
  }
  return {kind: 'frames', frames};
}

/**
 * 画面キャプチャで静止画を拾うための下ごしらえ。動画を指定位置で止め、
 * 切り抜きに使う表示上の矩形を返す。
 *
 * canvas から読み出せない動画（DRM や別オリジン）に対する回り道なので、
 * 1回の呼び出しで1枚分しか進めない。呼び出し側がキャプチャと交互に呼ぶ。
 *
 * @param {number} ratio 動画全体に対する位置（0〜1）。
 */
export async function freezeVideoAt(ratio) {
  const videos = [...document.querySelectorAll('video')]
    .filter((video) => video.videoWidth > 0)
    .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);

  const video = videos[0];
  if (!video) {
    return null;
  }

  const state = {previousTime: video.currentTime, wasPlaying: !video.paused};
  video.pause();

  // 画面キャプチャは表示されている範囲しか撮れないため、動画を画面内に入れる。
  video.scrollIntoView({block: 'center', inline: 'center'});

  if (Number.isFinite(video.duration) && video.duration > 0) {
    await new Promise((resolve) => {
      const timer = setTimeout(finish, 1500);
      function finish() {
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        resolve();
      }
      video.addEventListener('seeked', finish);
      video.currentTime = video.duration * (0.03 + 0.94 * ratio);
    });
  }

  const rect = video.getBoundingClientRect();
  return {
    state,
    devicePixelRatio: window.devicePixelRatio || 1,
    rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
  };
}

/**
 * freezeVideoAt で止めた動画を元の再生位置・再生状態に戻す。
 * @param {{previousTime: number, wasPlaying: boolean}} state
 */
export function restoreVideo(state) {
  const videos = [...document.querySelectorAll('video')]
    .filter((video) => video.videoWidth > 0)
    .sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight);

  const video = videos[0];
  if (!video || !state) {
    return;
  }

  video.currentTime = state.previousTime;
  if (state.wasPlaying) {
    video.play().catch(() => {});
  }
}
