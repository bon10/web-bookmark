'use server';

// ユビキタス言語: docs/ubiquitous-language.md
// このモジュールが扱うエンティティは「ブックマーク（Bookmark）」。
// DB 側のテーブル・カラムは videos / video_url / video_id のままなので、
// 「ブックマーク」への読み替えはこの層で閉じる（辞書の「用語の不一致」節を参照）。

import {revalidatePath} from 'next/cache';
import {createClient} from '@/utils/supabase/server';
import {deleteThumbnail, listThumbnailKeys, uploadThumbnail} from '@/utils/r2Client';

export type ActionResult = {error: string} | {error: null};

/**
 * ログイン。セッション Cookie は @supabase/ssr が書き込む。
 * 認証状態は Supabase の RLS が最終的な判定を行うため、ここでは権限チェックをしない。
 */
export async function signIn(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {error} = await supabase.auth.signInWithPassword({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });

  if (error) {
    return {error: error.message};
  }

  revalidatePath('/');
  return {error: null};
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/');
}

/**
 * タグ名から tags の行を引き当てる。同名タグは再利用し、無ければ作る。
 * 戻り値は tags.id。
 */
async function resolveTagId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tagName: string,
): Promise<number> {
  const {data: existingTag} = await supabase
    .from('tags')
    .select('id')
    .eq('name', tagName)
    .maybeSingle();

  if (existingTag) {
    return existingTag.id;
  }

  const {data: newTag, error} = await supabase
    .from('tags')
    .insert({name: tagName})
    .select('id')
    .single();

  if (error || !newTag) {
    throw new Error(`タグの作成に失敗しました (${tagName}): ${error?.message}`);
  }
  return newTag.id;
}

export async function addBookmark(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const title = String(formData.get('title') ?? '').trim();
  const url = String(formData.get('url') ?? '').trim();

  if (!title || !url) {
    return {error: 'タイトルとURLは必須です'};
  }

  const supabase = await createClient();
  const now = new Date().toISOString();

  // videos.rating には 1〜5 の CHECK 制約があるため、未入力と 0 は null にする。
  const ratingInput = Number(formData.get('rating'));
  const rating = Number.isFinite(ratingInput) && ratingInput >= 1 ? ratingInput : null;

  const {data: bookmark, error: bookmarkError} = await supabase
    .from('videos')
    .insert({
      title,
      video_url: url,
      sort_order: Number(formData.get('sort_order')) || 0,
      rating,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (bookmarkError || !bookmark) {
    return {error: `追加に失敗しました: ${bookmarkError?.message}`};
  }

  const tagNames = String(formData.get('tags') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  for (const tagName of tagNames) {
    const tagId = await resolveTagId(supabase, tagName);
    await supabase.from('video_tags').insert({video_id: bookmark.id, tag_id: tagId});
  }

  const thumbnails = formData
    .getAll('thumbnails')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const uploadedKeys: string[] = [];
  for (const thumbnail of thumbnails) {
    uploadedKeys.push(await uploadThumbnail(bookmark.id, thumbnail));
  }

  if (uploadedKeys.length > 0) {
    await supabase
      .from('thumbnails')
      .insert(
        uploadedKeys.map((thumbnailPath) => ({video_id: bookmark.id, thumbnail_path: thumbnailPath})),
      );
  }

  revalidatePath('/');
  return {error: null};
}

export async function deleteBookmark(bookmarkId: number): Promise<ActionResult> {
  const supabase = await createClient();

  const {error: bookmarkTagsError} = await supabase
    .from('video_tags')
    .delete()
    .eq('video_id', bookmarkId);
  if (bookmarkTagsError) {
    return {error: `タグの関連削除に失敗しました: ${bookmarkTagsError.message}`};
  }

  // R2 はディレクトリ単位で消せないので、配下のオブジェクトを列挙して1件ずつ削除する。
  const objectKeys = await listThumbnailKeys(bookmarkId);
  for (const objectKey of objectKeys) {
    await deleteThumbnail(objectKey);
  }

  const {error: thumbnailsError} = await supabase
    .from('thumbnails')
    .delete()
    .eq('video_id', bookmarkId);
  if (thumbnailsError) {
    return {error: `サムネイルの削除に失敗しました: ${thumbnailsError.message}`};
  }

  const {error: bookmarkError} = await supabase.from('videos').delete().eq('id', bookmarkId);
  if (bookmarkError) {
    return {error: `削除に失敗しました: ${bookmarkError.message}`};
  }

  revalidatePath('/');
  return {error: null};
}
