// ユビキタス言語: docs/ubiquitous-language.md
// Chrome 拡張からブックマークを1件登録する口。画面の「書架に納める」と同じ処理を通す。
//
// 画像は URL ではなく実体（multipart のファイル）で受け取る。サーバーから画像 URL を
// 取りに行くと、参照元ページの Cookie や Referer を付けられず 403 を返すサイトがあるため、
// 取得はページ上の拡張に任せる。
//
// CORS ヘッダーを付けない理由は app/api/tags/route.ts のコメントを参照。

import {revalidatePath} from 'next/cache';
import {authenticate, jsonError} from '@/utils/supabase/bearer';
import {createBookmark, MAX_THUMBNAILS} from '@/utils/bookmarks';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth.failure) {
    return auth.failure;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, 'multipart/form-data で送信してください');
  }

  // videos.rating には 1〜5 の CHECK 制約があるため、未入力と 0 は null にする。
  const ratingInput = Number(formData.get('rating'));
  const rating = Number.isFinite(ratingInput) && ratingInput >= 1 ? ratingInput : null;

  const thumbnails = formData
    .getAll('thumbnails')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (thumbnails.length > MAX_THUMBNAILS) {
    return jsonError(400, `サムネイルは${MAX_THUMBNAILS}枚までです`);
  }

  const result = await createBookmark(auth.client, {
    title: String(formData.get('title') ?? '').trim(),
    url: String(formData.get('url') ?? '').trim(),
    rating,
    sortOrder: Number(formData.get('sort_order')) || 0,
    tagNames: String(formData.get('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    thumbnails,
  });

  if (!result.ok) {
    return jsonError(400, result.error);
  }

  // 拡張から納めた直後に画面を開いても最新の一覧が出るようにする。
  revalidatePath('/');

  return Response.json({bookmarkId: result.bookmarkId}, {status: 201});
}
