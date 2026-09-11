// ユビキタス言語: docs/ubiquitous-language.md
// Chrome 拡張のタグ入力に出す候補を返す。母集合は画面側と同じ tags テーブル。
//
// このエンドポイントは Access-Control-Allow-Origin を付けない。
// 拡張の service worker からの fetch は host_permissions があれば自オリジン外へ出られるが、
// 一般の Web ページからの fetch は CORS で止まる。つまりヘッダーを付けないことが
// 「拡張からは使えて、どこかのページからは使えない」状態を作る。
// 出典: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

import {authenticate, jsonError} from '@/utils/supabase/bearer';

// 認証ヘッダーごとに結果が変わるため、レスポンスをキャッシュさせない。
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth.failure) {
    return auth.failure;
  }

  const {data, error} = await auth.client
    .from('tags')
    .select('name')
    .order('name', {ascending: true});
  if (error) {
    return jsonError(500, `タグの取得に失敗しました: ${error.message}`);
  }

  return Response.json({tags: data.map((tag) => tag.name)});
}
