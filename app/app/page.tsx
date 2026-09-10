// ユビキタス言語: docs/ubiquitous-language.md
// DB 行（videos / video_url / video_tags）を「ブックマーク（Bookmark）」に写し替える境界。
// これより下の層には video という語を出さない。

import type {ReactNode} from 'react';
import {createClient} from '@/utils/supabase/server';
import {thumbnailUrl} from '@/utils/thumbnailUrl';
import {signOut} from '@/app/actions';
import LoginForm from '@/components/LoginForm';
import AddBookmarkForm from '@/components/AddBookmarkForm';
import BookmarkArchive, {type Bookmark} from '@/components/BookmarkArchive';
import Seal from '@/components/Seal';
import ThemeToggle from '@/components/ThemeToggle';

// 一覧の内容はログイン中のセッションに依存するため、ビルド時に固定せずリクエストごとに描画する。
export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await createClient();

  // getSession() はサーバー側でトークンを検証しないため、認可判定には getClaims() を使う。
  const {data: claimsData} = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    return <LoginForm />;
  }

  // 一覧とタグ候補は互いに依存しないので同時に投げる。
  const [bookmarksResult, tagsResult] = await Promise.all([
    supabase
      .from('videos')
      .select('id, title, video_url, rating, video_tags(tags(id, name)), thumbnails(id, thumbnail_path)')
      .order('sort_order', {ascending: true}),
    supabase.from('tags').select('name').order('name', {ascending: true}),
  ]);

  if (bookmarksResult.error) {
    return (
      <Shell>
        <p role="alert" className="notice notice-error">
          一覧の取得に失敗しました: {bookmarksResult.error.message}
        </p>
      </Shell>
    );
  }

  // R2 は公開URLで直接配信するため、署名の発行が不要になり同期処理で済む。
  const bookmarks: Bookmark[] = (bookmarksResult.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    url: row.video_url,
    rating: row.rating,
    tags: row.video_tags.flatMap((videoTag) => (videoTag.tags ? [videoTag.tags] : [])),
    thumbnails: row.thumbnails.map((thumbnail) => ({
      id: thumbnail.id,
      url: thumbnailUrl(thumbnail.thumbnail_path),
    })),
  }));

  // タグの取得に失敗しても一覧は出す。候補が空になるだけで登録自体は続けられるため。
  const tagSuggestions = (tagsResult.data ?? []).map((tag) => tag.name);

  return (
    <Shell count={bookmarks.length}>
      <div className="grid items-start gap-8 lg:grid-cols-[330px_minmax(0,1fr)] lg:gap-10">
        <div className="lg:sticky lg:top-[88px]">
          <AddBookmarkForm tagSuggestions={tagSuggestions} />
        </div>
        <BookmarkArchive bookmarks={bookmarks} />
      </div>
    </Shell>
  );
}

/** ログイン後の共通の枠。ヘッダーの見た目をエラー時と一覧表示で揃えるために切り出している。 */
function Shell({children, count}: {children: ReactNode; count?: number}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 h-[72px] border-b border-line bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[1500px] items-center gap-4 px-5 lg:px-8">
          <Seal size={34} />

          <div className="min-w-0">
            <h1 className="truncate font-display text-[16px] font-semibold leading-tight tracking-[0.08em]">
              ブックマーク書架
            </h1>
            <p className="kicker mt-1">Web Archive</p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-4">
            {count !== undefined && (
              <p className="tnum hidden font-mono text-[11px] text-faint sm:block">
                {count} 件を所蔵
              </p>
            )}

            <ThemeToggle />

            <form action={signOut}>
              <button type="submit" className="btn btn-ghost px-3 py-1.5 text-[12px]">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-8 lg:px-8">{children}</main>
    </div>
  );
}
