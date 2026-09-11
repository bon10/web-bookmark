// ユビキタス言語: docs/ubiquitous-language.md
// ブックマークの URL を「同じページを指すなら同じ文字列」に揃える。
// 用途は2つ: 拡張が初期値として入れる URL を貼り付けに使える形にすること、
// および同じページを二重に納めていないかの突き合わせ。

/**
 * 計測用に後から足されるクエリパラメータ。参照先のページは同じなので、
 * 突き合わせでは無視し、初期値からも落とす。
 */
const TRACKING_PARAMS = [
  'gclid',
  'fbclid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'spm',
];

/**
 * クエリパラメータを1つに絞るホスト。
 * 動画サイトは再生位置・再生リスト・流入元がクエリに積まれるが、
 * 指している動画は同じなので動画IDだけを残す。
 */
const CANONICAL_QUERY_KEYS: Record<string, string[]> = {
  'www.youtube.com': ['v'],
  'www.nicovideo.jp': [],
};

/**
 * 同じページを指す URL の表記ゆれを1つに寄せる。ホスト名の小文字化とモバイル向け
 * ホストの統合に加え、短縮URL（youtu.be）は動画IDをパスに持つ形なので、
 * watch 形式へ書き換えるためパスとクエリも差し替える。
 */
function canonicalizeLocation(url: URL): void {
  const host = url.hostname.toLowerCase();

  if (host === 'youtu.be') {
    const videoId = url.pathname.slice(1);
    url.hostname = 'www.youtube.com';
    url.pathname = '/watch';
    url.search = videoId ? `?v=${videoId}` : '';
    return;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    url.hostname = 'www.youtube.com';
    return;
  }

  url.hostname = host;
}

/**
 * URL を突き合わせ用の形に正規化する。解釈できない文字列は落とさずそのまま返す
 * （利用者が手で入れた値を勝手に捨てないため）。
 *
 * 正規化でやること: scheme と host の小文字化、既定ポートの削除、計測パラメータの削除、
 * 動画サイトの動画ID以外のクエリの削除、残ったクエリのキー順ソート、フラグメントの削除。
 */
export function normalizeBookmarkUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return rawUrl.trim();
  }

  canonicalizeLocation(url);
  url.port = '';
  // フラグメントはページ内の位置でしかなく、同じページの別スクロール位置を
  // 別のブックマークとして数えたくないので落とす。
  url.hash = '';

  const canonicalKeys = CANONICAL_QUERY_KEYS[url.hostname];
  const params = new URLSearchParams(url.search);

  for (const key of [...params.keys()]) {
    const isTracking = key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.includes(key);
    const isOutsideCanonical = canonicalKeys !== undefined && !canonicalKeys.includes(key);

    if (isTracking || isOutsideCanonical) {
      params.delete(key);
    }
  }

  // クエリの並び順が違うだけの URL を同一とみなすため、キー順に並べ直す。
  const sorted = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b)));
  url.search = sorted.toString();

  // ルート直下の末尾スラッシュだけは落とす。下層のパスは、末尾スラッシュの有無で
  // 別ページを返すサイトがあるため触らない。
  if (url.pathname === '/') {
    return `${url.origin}${url.search}`;
  }

  return url.toString();
}
