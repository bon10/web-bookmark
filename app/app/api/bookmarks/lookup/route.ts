// ユビキタス言語: docs/ubiquitous-language.md
// 開いているページが既に書架にあるかを拡張が確かめる口。
// 同じ対象を二重に納めるのを防ぐために使う。完全一致だけでなく前方一致も候補として返し、
// 同じものかどうかの判断は利用者に委ねる。
//
// CORS ヘッダーを付けない理由は app/api/tags/route.ts のコメントを参照。

import {authenticate, jsonError} from '@/utils/supabase/bearer';
import {findRelatedBookmarks} from '@/utils/bookmarks';
import {normalizeBookmarkUrl} from '@/utils/bookmarkUrl';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth.failure) {
    return auth.failure;
  }

  const url = new URL(request.url).searchParams.get('url')?.trim() ?? '';
  if (!url) {
    return jsonError(400, 'url を指定してください');
  }

  const matches = await findRelatedBookmarks(auth.client, url);

  return Response.json({
    // 拡張の URL 欄の初期値に使う。計測パラメータを落とした、貼り付けて使える形。
    normalizedUrl: normalizeBookmarkUrl(url),
    matches,
  });
}
