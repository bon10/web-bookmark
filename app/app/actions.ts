'use server';

// ユビキタス言語: docs/ubiquitous-language.md
// このモジュールが扱うエンティティは「ブックマーク（Bookmark）」。
// DB 側の videos / video_url / video_id への読み替えは utils/bookmarks.ts に閉じているため、
// このファイルには video という語を出さない。

import {revalidatePath} from 'next/cache';
import {createClient} from '@/utils/supabase/server';
import {createBookmark, destroyBookmark, updateBookmark} from '@/utils/bookmarks';

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

/** 登録フォームと編集フォームで同じ項目を読む。 */
function readFields(formData: FormData) {
  // videos.rating には 1〜5 の CHECK 制約があるため、未入力と 0 は null にする。
  const ratingInput = Number(formData.get('rating'));

  return {
    title: String(formData.get('title') ?? '').trim(),
    url: String(formData.get('url') ?? '').trim(),
    rating: Number.isFinite(ratingInput) && ratingInput >= 1 ? ratingInput : null,
    sortOrder: Number(formData.get('sort_order')) || 0,
    tagNames: String(formData.get('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

/** 今回新しく添付された画像だけを取り出す。空の input は除く。 */
function readThumbnails(formData: FormData): File[] {
  return formData
    .getAll('thumbnails')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

export async function addBookmark(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();

  const result = await createBookmark(supabase, {
    ...readFields(formData),
    thumbnails: readThumbnails(formData),
  });

  if (!result.ok) {
    return {error: result.error};
  }

  revalidatePath('/');
  return {error: null};
}

export async function editBookmark(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const bookmarkId = Number(formData.get('id'));
  if (!Number.isInteger(bookmarkId) || bookmarkId <= 0) {
    return {error: '編集対象のブックマークが分かりません'};
  }

  const supabase = await createClient();

  const result = await updateBookmark(supabase, bookmarkId, {
    ...readFields(formData),
    addedThumbnails: readThumbnails(formData),
    removedThumbnailIds: formData
      .getAll('removed_thumbnails')
      .map((value) => Number(value))
      .filter((id) => Number.isInteger(id) && id > 0),
  });

  if (!result.ok) {
    return {error: result.error};
  }

  revalidatePath('/');
  return {error: null};
}

export async function deleteBookmark(bookmarkId: number): Promise<ActionResult> {
  const supabase = await createClient();

  const error = await destroyBookmark(supabase, bookmarkId);
  if (error) {
    return {error};
  }

  revalidatePath('/');
  return {error: null};
}
