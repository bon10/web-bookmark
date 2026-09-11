'use server';

// ユビキタス言語: docs/ubiquitous-language.md
// このモジュールが扱うエンティティは「ブックマーク（Bookmark）」。
// DB 側の videos / video_url / video_id への読み替えは utils/bookmarks.ts に閉じているため、
// このファイルには video という語を出さない。

import {revalidatePath} from 'next/cache';
import {createClient} from '@/utils/supabase/server';
import {createBookmark, destroyBookmark} from '@/utils/bookmarks';

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

export async function addBookmark(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();

  // videos.rating には 1〜5 の CHECK 制約があるため、未入力と 0 は null にする。
  const ratingInput = Number(formData.get('rating'));
  const rating = Number.isFinite(ratingInput) && ratingInput >= 1 ? ratingInput : null;

  const result = await createBookmark(supabase, {
    title: String(formData.get('title') ?? '').trim(),
    url: String(formData.get('url') ?? '').trim(),
    rating,
    sortOrder: Number(formData.get('sort_order')) || 0,
    tagNames: String(formData.get('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    thumbnails: formData
      .getAll('thumbnails')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0),
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
