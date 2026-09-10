'use client';

// ユビキタス言語: docs/ubiquitous-language.md
// 「ブックマーク（Bookmark）」の一覧・絞り込み・削除を受け持つ。

import {useEffect, useMemo, useState, useTransition} from 'react';
import Image from 'next/image';
import ReactPaginate from 'react-paginate';
import StarRating from '@/components/StarRating';
import {deleteBookmark} from '@/app/actions';

export type Bookmark = {
  id: number;
  title: string | null;
  url: string;
  rating: number | null;
  tags: {id: number; name: string}[];
  thumbnails: {id: number; url: string}[];
};

type ViewMode = 'grid' | 'list';

const BOOKMARKS_PER_PAGE = 30;

/** URL のホスト名だけを取り出す。不正な URL でも一覧を壊さないよう、失敗時は元の文字列を返す。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function BookmarkArchive({bookmarks}: {bookmarks: Bookmark[]}) {
  const [query, setQuery] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [view, setView] = useState<ViewMode>('grid');
  const [currentPage, setCurrentPage] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  // タグ一覧は登録件数の多い順に出す。よく使うタグほど手前に来るようにするため。
  const tagIndex = useMemo(() => {
    const counts = new Map<number, {id: number; name: string; count: number}>();
    for (const bookmark of bookmarks) {
      for (const tag of bookmark.tags) {
        const entry = counts.get(tag.id);
        if (entry) {
          entry.count += 1;
        } else {
          counts.set(tag.id, {id: tag.id, name: tag.name, count: 1});
        }
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
  }, [bookmarks]);

  // 選んだタグは AND で絞り込む（複数選択は「両方を持つもの」の意味にする）。
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bookmarks.filter((bookmark) => {
      const matchesTags = selectedTagIds.every((tagId) =>
        bookmark.tags.some((tag) => tag.id === tagId),
      );
      if (!matchesTags) {
        return false;
      }
      if (needle === '') {
        return true;
      }
      const haystack = [bookmark.title ?? '', bookmark.url, ...bookmark.tags.map((tag) => tag.name)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [bookmarks, query, selectedTagIds]);

  const pageCount = Math.ceil(filtered.length / BOOKMARKS_PER_PAGE);
  // 削除で件数が減ると currentPage が最終ページを追い越すことがあるので、参照時に丸める。
  const page = Math.min(currentPage, Math.max(0, pageCount - 1));
  const pageItems = filtered.slice(page * BOOKMARKS_PER_PAGE, (page + 1) * BOOKMARKS_PER_PAGE);

  // ページを移動したら先頭まで戻す。
  useEffect(() => {
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, [currentPage]);

  // 絞り込みを変えると総ページ数が変わるため、条件を触るたびに先頭ページへ戻す。
  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setCurrentPage(0);
  }

  function toggleTag(tagId: number) {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
    setCurrentPage(0);
  }

  function clearFilters() {
    setQuery('');
    setSelectedTagIds([]);
    setCurrentPage(0);
  }

  function handleDelete(bookmarkId: number) {
    if (!window.confirm('本当にこのブックマークを削除してもよろしいですか？')) {
      return;
    }
    startDeleting(async () => {
      const result = await deleteBookmark(bookmarkId);
      setErrorMessage(result.error);
    });
  }

  const isFiltered = query.trim() !== '' || selectedTagIds.length > 0;

  return (
    <div>
      {/* ---- 絞り込みと表示切り替え ---- */}
      <div className="sticky top-[72px] z-20 -mx-1 bg-ink/85 px-1 py-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-faint"
            >
              /
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="タイトル・URL・タグで絞り込む"
              aria-label="ブックマークを絞り込む"
              className="field py-2 pl-7"
            />
          </div>

          <div className="flex border border-line">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={view === mode}
                className={`px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
                  view === mode ? 'bg-shu/[0.12] text-shu-lit' : 'text-faint hover:text-text'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <span className="tnum shrink-0 font-mono text-[11px] text-faint">
            {filtered.length} / {bookmarks.length}
          </span>
        </div>

        {tagIndex.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tagIndex.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                aria-pressed={selectedTagIds.includes(tag.id)}
                className={`chip ${selectedTagIds.includes(tag.id) ? 'chip-on' : 'hover:border-dim hover:text-text'}`}
              >
                {tag.name}
                <span className="tnum font-mono text-[10px] opacity-50">{tag.count}</span>
              </button>
            ))}
            {isFiltered && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint transition-colors hover:text-shu-lit"
              >
                reset
              </button>
            )}
          </div>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="notice notice-error mb-6">
          {errorMessage}
        </p>
      )}

      {/* ---- 一覧 ---- */}
      {pageItems.length === 0 ? (
        <div className="mt-16 border border-dashed border-line py-24 text-center">
          <p className="font-display text-2xl text-faint">
            {isFiltered ? '該当なし' : '書架はまだ空です'}
          </p>
          <p className="mt-3 text-[12px] text-faint">
            {isFiltered ? '条件をゆるめてみてください。' : '左のフォームから最初の1件を納めましょう。'}
          </p>
        </div>
      ) : view === 'grid' ? (
        <ul className="mt-2 grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {pageItems.map((bookmark) => (
            <li key={bookmark.id}>
              <ArchiveCard bookmark={bookmark} onDelete={handleDelete} isDeleting={isDeleting} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {pageItems.map((bookmark) => (
            <li key={bookmark.id}>
              <ArchiveRow bookmark={bookmark} onDelete={handleDelete} isDeleting={isDeleting} />
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <ReactPaginate
          previousLabel={'←'}
          nextLabel={'→'}
          breakLabel={'···'}
          breakClassName={'break-me'}
          pageCount={pageCount}
          marginPagesDisplayed={1}
          pageRangeDisplayed={3}
          onPageChange={({selected}) => setCurrentPage(selected)}
          containerClassName={'pagination'}
          activeClassName={'active'}
          pageClassName={'page'}
          previousClassName={'previous'}
          nextClassName={'next'}
          disabledClassName={'disabled'}
          forcePage={page}
        />
      )}
    </div>
  );
}

type ItemProps = {
  bookmark: Bookmark;
  onDelete: (bookmarkId: number) => void;
  isDeleting: boolean;
};

function DeleteButton({bookmark, onDelete, isDeleting}: ItemProps) {
  return (
    <button
      type="button"
      onClick={() => onDelete(bookmark.id)}
      disabled={isDeleting}
      aria-label={`「${bookmark.title ?? bookmark.url}」を削除`}
      className="border border-line bg-ink/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint backdrop-blur-sm transition-colors hover:border-shu hover:text-shu-lit disabled:opacity-40"
    >
      del
    </button>
  );
}

function ArchiveCard({bookmark, onDelete, isDeleting}: ItemProps) {
  const [cover, ...rest] = bookmark.thumbnails;

  return (
    <article className="group relative flex h-full flex-col bg-panel transition-colors duration-300 hover:bg-raise">
      <div className="relative aspect-[16/10] overflow-hidden bg-raise">
        {cover ? (
          <Image
            src={cover.url}
            alt=""
            fill
            sizes="(min-width: 1280px) 24vw, (min-width: 640px) 44vw, 92vw"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
          />
        ) : (
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center font-display text-4xl text-line"
          >
            栞
          </span>
        )}

        <span className="tnum absolute left-0 top-0 bg-ink/75 px-2 py-1 font-mono text-[10px] text-faint backdrop-blur-sm">
          {String(bookmark.id).padStart(3, '0')}
        </span>

        {rest.length > 0 && (
          <span className="tnum absolute bottom-2 right-2 bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-dim backdrop-blur-sm">
            +{rest.length}
          </span>
        )}

        <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <DeleteButton bookmark={bookmark} onDelete={onDelete} isDeleting={isDeleting} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          className="font-display text-[15px] font-semibold leading-[1.6] text-text decoration-shu decoration-1 underline-offset-4 transition-colors hover:text-shu hover:underline"
        >
          {bookmark.title || '(無題)'}
        </a>

        <p className="truncate font-mono text-[10px] text-faint">{hostOf(bookmark.url)}</p>

        {bookmark.rating !== null && (
          <div className="flex items-center gap-2">
            <StarRating value={bookmark.rating} size={12} />
            <span className="tnum font-mono text-[10px] text-faint">{bookmark.rating.toFixed(1)}</span>
          </div>
        )}

        {bookmark.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {bookmark.tags.map((tag) => (
              <span key={tag.id} className="chip">
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ホバーで下端に朱の罫を引く。 */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-shu transition-transform duration-500 ease-out group-hover:scale-x-100"
      />
    </article>
  );
}

function ArchiveRow({bookmark, onDelete, isDeleting}: ItemProps) {
  const [cover, ...rest] = bookmark.thumbnails;

  return (
    <article className="group flex items-center gap-4 py-3 transition-colors hover:bg-panel">
      <span className="tnum w-10 shrink-0 pl-1 font-mono text-[11px] text-faint">
        {String(bookmark.id).padStart(3, '0')}
      </span>

      <div className="relative h-12 w-20 shrink-0 overflow-hidden border border-line bg-raise">
        {cover ? (
          <Image src={cover.url} alt="" fill sizes="80px" className="object-cover" />
        ) : (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center font-display text-sm text-line">
            栞
          </span>
        )}
        {rest.length > 0 && (
          <span className="tnum absolute bottom-0 right-0 bg-ink/80 px-1 font-mono text-[9px] text-dim">
            +{rest.length}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-display text-[14px] font-semibold text-text transition-colors hover:text-shu"
        >
          {bookmark.title || '(無題)'}
        </a>
        <p className="truncate font-mono text-[10px] text-faint">{hostOf(bookmark.url)}</p>
      </div>

      <div className="hidden w-[10rem] shrink-0 flex-wrap gap-1 lg:flex">
        {bookmark.tags.slice(0, 3).map((tag) => (
          <span key={tag.id} className="chip">
            {tag.name}
          </span>
        ))}
      </div>

      <div className="hidden w-[6.5rem] shrink-0 items-center gap-2 sm:flex">
        {bookmark.rating !== null && (
          <>
            <StarRating value={bookmark.rating} size={11} />
            <span className="tnum font-mono text-[10px] text-faint">{bookmark.rating.toFixed(1)}</span>
          </>
        )}
      </div>

      <div className="shrink-0 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <DeleteButton bookmark={bookmark} onDelete={onDelete} isDeleting={isDeleting} />
      </div>
    </article>
  );
}
