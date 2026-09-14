import 'server-only';

// ユビキタス言語: docs/ubiquitous-language.md
// 「ブックマーク（Bookmark）」の書き込み側の境界。DB のテーブル・カラムは
// videos / video_url / video_id のままなので、読み替えはこのファイルに閉じる。
// 呼び出し元（Server Action / Route Handler）に video という語を出さない。

import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/types/schema';
import {deleteThumbnail, listThumbnailKeys, uploadThumbnail} from '@/utils/r2Client';
import {normalizeBookmarkUrl} from '@/utils/bookmarkUrl';

export type BookmarkClient = SupabaseClient<Database>;

// サムネイルの上限は「枚数」「1枚の大きさ」「一度に送る合計」の3つで、役割が別々。
// 数字は次の順に収まっていること。崩れると、どれかの規則が名ばかりになる。
//
//   next.config.js の bodySizeLimit（16MB）
//     > MAX_TOTAL_THUMBNAIL_BYTES（15MB）… 一度に送れる合計
//       > MAX_THUMBNAIL_BYTES（8MB）… 1枚の上限
//
// 枚数の上限は容量とは別の軸で、掛け算では上の合計に収まらない（10枚 × 8MB ＝ 80MB）。
// 10枚すべてを一度に送れるのは1枚あたり平均 1.5MB までのときで、それを超えると
// 枚数に達する前に合計で止まる。拡張が抜く静止画は1枚 700KB 前後なので、通常は収まる。

/**
 * 1件に添付できるサムネイルの枚数の上限。拡張が出す候補（10枚前後）を全部選んでも通る値にする。
 * Route Handler は誰でも叩ける口なので、画面側の制限とは別に、この層でも必ず検査する。
 */
export const MAX_THUMBNAILS = 10;

/**
 * 1枚あたりのサイズ上限。R2 への転送とブラウザの描画が現実的に収まる範囲。
 * 「この1枚が大きすぎる」を、合計に達する前に指摘するための規則。
 */
export const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/**
 * 一度に送れるサムネイルの合計サイズ。
 *
 * 画面からの登録・編集は Server Action を通るため、Next.js が本文の大きさを見て
 * リクエストを打ち切る（next.config.js の `serverActions.bodySizeLimit`）。打ち切られると
 * この層まで届かず、利用者には理由の分からないエラーだけが出る。そこで設定値より内側に
 * 上限を置き、こちらの言葉で先に知らせる。**next.config.js の値を変えるときはここも合わせること。**
 */
export const MAX_TOTAL_THUMBNAIL_BYTES = 15 * 1024 * 1024;

/** 受け取る画像形式。ここに無い Content-Type は拒否する。 */
export const ALLOWED_THUMBNAIL_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
];

/** 登録と更新で共通の入力。 */
export type BookmarkFields = {
  title: string;
  url: string;
  /** 未評価は null。videos.rating に 1〜5 の CHECK 制約があるため 0 を入れない。 */
  rating: number | null;
  sortOrder: number;
  tagNames: string[];
};

export type NewBookmark = BookmarkFields & {
  thumbnails: File[];
};

export type BookmarkEdit = BookmarkFields & {
  /** 新しく足すサムネイル。 */
  addedThumbnails: File[];
  /** 外すサムネイルの thumbnails.id。R2 のオブジェクトも消す。 */
  removedThumbnailIds: number[];
};

/**
 * 成否は `ok` で分ける。`error` の有無で分けると、型が string | null になり
 * 呼び出し側で成功側への絞り込みが効かない。
 */
export type CreateBookmarkResult = {ok: true; bookmarkId: number} | {ok: false; error: string};

/**
 * タグ名から tags の行を引き当てる。同名タグは再利用し、無ければ作る。
 * 戻り値は tags.id。
 */
async function resolveTagId(client: BookmarkClient, tagName: string): Promise<number> {
  const {data: existingTag} = await client
    .from('tags')
    .select('id')
    .eq('name', tagName)
    .maybeSingle();

  if (existingTag) {
    return existingTag.id;
  }

  const {data: newTag, error} = await client
    .from('tags')
    .insert({name: tagName})
    .select('id')
    .single();

  if (error || !newTag) {
    throw new Error(`タグの作成に失敗しました (${tagName}): ${error?.message}`);
  }
  return newTag.id;
}

/** タグ名を解決して関連を張る。既に張ってある関連は先に消しておくこと。 */
async function attachTags(
  client: BookmarkClient,
  bookmarkId: number,
  tagNames: string[],
): Promise<void> {
  for (const tagName of tagNames) {
    const tagId = await resolveTagId(client, tagName);
    await client.from('video_tags').insert({video_id: bookmarkId, tag_id: tagId});
  }
}

/** 画像を R2 に保存し、thumbnails に行を足す。 */
async function addThumbnails(
  client: BookmarkClient,
  bookmarkId: number,
  thumbnails: File[],
): Promise<void> {
  const uploadedKeys: string[] = [];
  for (const thumbnail of thumbnails) {
    uploadedKeys.push(await uploadThumbnail(bookmarkId, thumbnail));
  }

  if (uploadedKeys.length > 0) {
    await client.from('thumbnails').insert(
      uploadedKeys.map((thumbnailPath) => ({
        video_id: bookmarkId,
        thumbnail_path: thumbnailPath,
      })),
    );
  }
}

/**
 * 指定したサムネイルを R2 と DB の両方から消す。
 *
 * `video_id` も条件に入れるのは、別のブックマークのサムネイルの id を渡されても
 * 消えないようにするため（id だけで消すと取り違えが起きうる）。
 */
async function removeThumbnails(
  client: BookmarkClient,
  bookmarkId: number,
  thumbnailIds: number[],
): Promise<void> {
  if (thumbnailIds.length === 0) {
    return;
  }

  const {data: rows} = await client
    .from('thumbnails')
    .select('id, thumbnail_path')
    .eq('video_id', bookmarkId)
    .in('id', thumbnailIds);

  if (!rows || rows.length === 0) {
    return;
  }

  for (const row of rows) {
    await deleteThumbnail(row.thumbnail_path);
  }

  await client
    .from('thumbnails')
    .delete()
    .in(
      'id',
      rows.map((row) => row.id),
    );
}

/**
 * 入力の検査。画面からの送信と拡張からの送信で同じ規則を通すため、ここに集める。
 * 戻り値は最初に見つかった不備の説明。不備が無ければ null。
 *
 * @param thumbnails 今回新しく受け取る画像。既に保存済みのものは数えない。
 */
function validate(input: BookmarkFields, thumbnails: File[]): string | null {
  if (!input.title) {
    return 'タイトルは必須です';
  }
  if (!input.url) {
    return 'URLは必須です';
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return 'URLの形式が正しくありません';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URLは http または https で始まる必要があります';
  }

  if (input.rating !== null && (input.rating < 1 || input.rating > 5)) {
    return '評価は1〜5の範囲で指定してください';
  }

  if (!Number.isInteger(input.sortOrder)) {
    return '表示順は整数で指定してください';
  }

  if (thumbnails.length > MAX_THUMBNAILS) {
    return `サムネイルは${MAX_THUMBNAILS}枚までです`;
  }
  for (const thumbnail of thumbnails) {
    if (thumbnail.size > MAX_THUMBNAIL_BYTES) {
      return `サムネイル1枚のサイズは${MAX_THUMBNAIL_BYTES / 1024 / 1024}MBまでです`;
    }
    if (!ALLOWED_THUMBNAIL_TYPES.includes(thumbnail.type)) {
      return `対応していない画像形式です (${thumbnail.type || '不明'})`;
    }
  }

  const totalBytes = thumbnails.reduce((total, thumbnail) => total + thumbnail.size, 0);
  if (totalBytes > MAX_TOTAL_THUMBNAIL_BYTES) {
    const asMegabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    return `サムネイルの合計サイズは${asMegabytes(MAX_TOTAL_THUMBNAIL_BYTES)}MBまでです（今回は${asMegabytes(totalBytes)}MB）。枚数を減らすか、分けて登録してください`;
  }

  return null;
}

/**
 * ブックマークを1件作る。タグの引き当て・作成とサムネイルの R2 への保存まで行う。
 *
 * @param client 呼び出し元のセッションで作った Supabase クライアント。
 *   権限の最終判定は DB 側の RLS が行うため、この関数では認可を見ない。
 */
export async function createBookmark(
  client: BookmarkClient,
  input: NewBookmark,
): Promise<CreateBookmarkResult> {
  const invalid = validate(input, input.thumbnails);
  if (invalid) {
    return {ok: false, error: invalid};
  }

  const now = new Date().toISOString();

  const {data: bookmark, error: bookmarkError} = await client
    .from('videos')
    .insert({
      title: input.title,
      video_url: input.url,
      sort_order: input.sortOrder,
      rating: input.rating,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (bookmarkError || !bookmark) {
    return {ok: false, error: `追加に失敗しました: ${bookmarkError?.message}`};
  }

  await attachTags(client, bookmark.id, input.tagNames);
  await addThumbnails(client, bookmark.id, input.thumbnails);

  return {ok: true, bookmarkId: bookmark.id};
}

/**
 * ブックマークを1件書き換える。
 *
 * タグは「いったん全部外してから張り直す」。差分を求めるより単純で、件数が少ないため
 * 負荷も問題にならない。サムネイルは既存のものを残したまま、外す指定のものだけを消し、
 * 新しく受け取ったものを足す（既存を全部消して入れ直すと、R2 のキーが変わって
 * 画像の URL が無駄に変わる）。
 */
export async function updateBookmark(
  client: BookmarkClient,
  bookmarkId: number,
  input: BookmarkEdit,
): Promise<CreateBookmarkResult> {
  const invalid = validate(input, input.addedThumbnails);
  if (invalid) {
    return {ok: false, error: invalid};
  }

  const {error: bookmarkError} = await client
    .from('videos')
    .update({
      title: input.title,
      video_url: input.url,
      sort_order: input.sortOrder,
      rating: input.rating,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookmarkId);

  if (bookmarkError) {
    return {ok: false, error: `更新に失敗しました: ${bookmarkError.message}`};
  }

  const {error: tagsError} = await client
    .from('video_tags')
    .delete()
    .eq('video_id', bookmarkId);
  if (tagsError) {
    return {ok: false, error: `タグの張り替えに失敗しました: ${tagsError.message}`};
  }
  await attachTags(client, bookmarkId, input.tagNames);

  await removeThumbnails(client, bookmarkId, input.removedThumbnailIds);
  await addThumbnails(client, bookmarkId, input.addedThumbnails);

  return {ok: true, bookmarkId};
}

/**
 * ブックマークと、それにぶら下がるタグの関連・サムネイルを消す。
 * 戻り値は失敗の説明。成功時は null。
 */
export async function destroyBookmark(
  client: BookmarkClient,
  bookmarkId: number,
): Promise<string | null> {
  const {error: bookmarkTagsError} = await client
    .from('video_tags')
    .delete()
    .eq('video_id', bookmarkId);
  if (bookmarkTagsError) {
    return `タグの関連削除に失敗しました: ${bookmarkTagsError.message}`;
  }

  // R2 はディレクトリ単位で消せないので、配下のオブジェクトを列挙して1件ずつ削除する。
  const objectKeys = await listThumbnailKeys(bookmarkId);
  for (const objectKey of objectKeys) {
    await deleteThumbnail(objectKey);
  }

  const {error: thumbnailsError} = await client
    .from('thumbnails')
    .delete()
    .eq('video_id', bookmarkId);
  if (thumbnailsError) {
    return `サムネイルの削除に失敗しました: ${thumbnailsError.message}`;
  }

  const {error: bookmarkError} = await client.from('videos').delete().eq('id', bookmarkId);
  if (bookmarkError) {
    return `削除に失敗しました: ${bookmarkError.message}`;
  }

  return null;
}

/** 一致の近さ。`exact` が最も近い。 */
export type MatchKind = 'exact' | 'prefix';

export type BookmarkMatch = {
  id: number;
  title: string | null;
  url: string;
  match: MatchKind;
};

/** 突き合わせで返す上限。多すぎると選ぶ手間が増えるだけなので切る。 */
const MAX_MATCHES = 10;

/**
 * 一方が他方の前方かどうかを、パスの区切りで判定する。
 *
 * 単純な startsWith だと `/072118-01` が `/072118-011` に一致してしまうため、
 * 残りが区切り（`/` か `?`）で始まるか、空であることを求める。
 */
function isPrefixOf(shorter: string, longer: string): boolean {
  if (!longer.startsWith(shorter)) {
    return false;
  }
  const rest = longer.slice(shorter.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('?') || shorter.endsWith('/');
}

/**
 * 同じページ、または同じものを指していそうなブックマークを探す。
 *
 * 完全一致だけだと、クエリ違い・下層ページ・一覧と詳細のような URL の揺れで
 * 同じ対象を二重に納めてしまう。そこで**前方一致まで広げて候補として返し、
 * 同じものかどうかの判断は利用者に任せる**（自動で登録を止めることはしない）。
 *
 * 突き合わせは正規化した URL で行いたいが、DB には利用者が入れたままの URL しか
 * 無いため、比較は取得後に行う。自分用のアプリで件数が数百件規模に収まるので、
 * URL 列だけを全件引いて突き合わせる。
 */
export async function findRelatedBookmarks(
  client: BookmarkClient,
  url: string,
): Promise<BookmarkMatch[]> {
  const {data, error} = await client.from('videos').select('id, title, video_url');
  if (error || !data) {
    return [];
  }

  const needle = normalizeBookmarkUrl(url);
  const matches: BookmarkMatch[] = [];

  for (const row of data) {
    const candidate = normalizeBookmarkUrl(row.video_url);

    let match: MatchKind | null = null;
    if (candidate === needle) {
      match = 'exact';
    } else if (isPrefixOf(needle, candidate) || isPrefixOf(candidate, needle)) {
      match = 'prefix';
    }

    if (match) {
      matches.push({id: row.id, title: row.title, url: row.video_url, match});
    }
  }

  // 近い順に並べ、同じ近さなら登録が古いものから出す。
  matches.sort((a, b) => {
    if (a.match !== b.match) {
      return a.match === 'exact' ? -1 : 1;
    }
    return a.id - b.id;
  });

  return matches.slice(0, MAX_MATCHES);
}
