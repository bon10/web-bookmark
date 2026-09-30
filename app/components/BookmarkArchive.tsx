'use client';

// ユビキタス言語: docs/ubiquitous-language.md
// 「ブックマーク（Bookmark）」の一覧・絞り込み・削除を受け持つ。

import {useEffect, useMemo, useRef, useState, useTransition} from 'react';
import Image from 'next/image';
import {usePathname, useSearchParams} from 'next/navigation';
import ReactPaginate from 'react-paginate';
import StarRating from '@/components/StarRating';
import ThumbnailCarousel from '@/components/ThumbnailCarousel';
import EditBookmarkDialog from '@/components/EditBookmarkDialog';
import {deleteBookmark} from '@/app/actions';
import {
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  DEFAULT_VIEW_MODE,
  SORT_OPTIONS,
  parseSortDir,
  parseSortKey,
  parseViewMode,
  readArchiveView,
  writeArchiveView,
  type SortDir,
  type SortKey,
  type ViewMode,
} from '@/utils/archiveView';

export type Bookmark = {
  id: number;
  title: string | null;
  url: string;
  rating: number | null;
  /** 一覧の「追加日」と並べ替えの「追加順」に使う。ISO 8601 の文字列なので辞書順の比較で時刻順になる。 */
  createdAt: string;
  /** 一覧の「更新日」と並べ替えの「更新順」に使う。書き換えるたびに `videos.updated_at` が更新される。 */
  updatedAt: string;
  sortOrder: number;
  tags: {id: number; name: string}[];
  thumbnails: {id: number; url: string}[];
};

const BOOKMARKS_PER_PAGE = 30;

// タグが増えると絞り込み欄だけで画面が埋まるため、既定ではこの件数までしか出さない。
const TAG_COLLAPSED_COUNT = 12;

function parseTagIds(value: string | null): number[] {
  return (value ?? '')
    .split(',')
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export default function BookmarkArchive({
  bookmarks,
  tagSuggestions,
}: {
  bookmarks: Bookmark[];
  tagSuggestions: string[];
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // 一覧の状態は URL のクエリを正とする。手元の state に写して持たないのは、
  // 戻る・進むで URL が変わったときに、画面がその状態へ素直に追従するようにするため。
  const selectedTagIds = useMemo(() => parseTagIds(searchParams.get('tags')), [searchParams]);
  const sortKey = parseSortKey(searchParams.get('sort')) ?? DEFAULT_SORT_KEY;
  const sortDir = parseSortDir(searchParams.get('dir')) ?? DEFAULT_SORT_DIR;
  const view = parseViewMode(searchParams.get('view')) ?? DEFAULT_VIEW_MODE;
  // URL では 1 始まり。内部は 0 始まりで持つ。
  const currentPage = Math.max(0, Number(searchParams.get('page') ?? '1') - 1);
  const editingId = Number(searchParams.get('edit')) || null;

  // 検索語だけは打つたびに描き直したいので手元にも持ち、URL へは写すだけにする。
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);

  // 戻る・進むや、共有された URL を開いたときに検索欄を合わせる。
  // エフェクトではなくレンダー中に調整するのは、URL が変わってから入力欄が追いつくまでの
  // 1回分の再描画を挟まないため（React の「props が変わったときに state を調整する」書き方）。
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);
  if (syncedQuery !== urlQuery) {
    setSyncedQuery(urlQuery);
    setQuery(urlQuery);
  }

  const [showAllTags, setShowAllTags] = useState(false);
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

  // 折りたたみ中でも、選択済みのタグは必ず見せる（外せなくなるのを防ぐ）。
  const listedTags = useMemo(() => {
    if (showAllTags || tagIndex.length <= TAG_COLLAPSED_COUNT) {
      return tagIndex;
    }
    const head = tagIndex.slice(0, TAG_COLLAPSED_COUNT);
    const selectedBeyondHead = tagIndex
      .slice(TAG_COLLAPSED_COUNT)
      .filter((tag) => selectedTagIds.includes(tag.id));
    return [...head, ...selectedBeyondHead];
  }, [tagIndex, showAllTags, selectedTagIds]);

  // 選んだタグは AND で絞り込む（複数選択は「すべて持つもの」の意味にする）。
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

  const sorted = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1;

    // 基準の値が同じときは id で決める。id は重複しないので、並べ替えのたびに順番が揺れることはない。
    //
    // 昇順で固定せず向きに合わせるのは、**同じ時刻・同じ評価のブックマークが多いときに
    // 昇順と降順で同じ並びになってしまうのを避けるため**。とくに追加日・更新日は
    // まとめて登録すると全件同じ時刻になりうるので、その場合は id の降順＝新しい順で出す。
    const byId = (a: Bookmark, b: Bookmark) => factor * (a.id - b.id);

    return [...filtered].sort((a, b) => {
      if (sortKey === 'created') {
        return factor * a.createdAt.localeCompare(b.createdAt) || byId(a, b);
      }
      if (sortKey === 'updated') {
        return factor * a.updatedAt.localeCompare(b.updatedAt) || byId(a, b);
      }
      // ここから下は評価順。未評価は比べる値が無いので、昇順でも降順でも末尾に送る。
      if (a.rating === null || b.rating === null) {
        if (a.rating === b.rating) {
          return byId(a, b);
        }
        return a.rating === null ? 1 : -1;
      }
      return factor * (a.rating - b.rating) || byId(a, b);
    });
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.ceil(sorted.length / BOOKMARKS_PER_PAGE);
  // 削除で件数が減ると currentPage が最終ページを追い越すことがあるので、参照時に丸める。
  const page = Math.min(currentPage, Math.max(0, pageCount - 1));
  const pageItems = sorted.slice(page * BOOKMARKS_PER_PAGE, (page + 1) * BOOKMARKS_PER_PAGE);

  // 編集対象。削除済みの id が URL に残っていた場合は無いものとして扱う。
  const editing = editingId === null ? null : bookmarks.find((item) => item.id === editingId) ?? null;

  // ページを移動したら先頭まで戻す。
  useEffect(() => {
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, [currentPage]);

  /**
   * 一覧の状態を URL に書く。既定値はクエリに出さず、素の URL を短く保つ。
   *
   * 既定は pushState。**戻るボタンで直前の絞り込み・並び・ページに戻れるようにするため**
   * （replaceState だけだと履歴が積まれず、戻ると書架そのものから出てしまう）。
   * 文字入力のように連続して変わるものだけ replaceState にし、1文字ごとに履歴が増えるのを防ぐ。
   *
   * Next の router ではなく history API を使うのは、ここでの状態変化がすべてクライアント側の
   * 処理で、サーバーから取り直す必要がないため。pushState / replaceState が Next の router と
   * 同期することは公式ドキュメントに明記されている。
   */
  function writeParams(updates: Record<string, string | null>, mode: 'push' | 'replace' = 'push') {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const queryString = params.toString();
    const url = queryString === '' ? pathname : `${pathname}?${queryString}`;
    if (mode === 'push') {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
  }

  // 前回の見え方（並べ替えと表示形式）を復元する。初回の描画後に一度だけ行う。
  // URL に指定があるときは何もしない。共有された URL の見え方を手元の記憶で
  // 上書きしてしまわないため。履歴には積まない（戻る先が増えると戻りにくくなる）。
  const didRestoreView = useRef(false);
  useEffect(() => {
    if (didRestoreView.current) {
      return;
    }
    didRestoreView.current = true;

    if (searchParams.has('sort') || searchParams.has('dir') || searchParams.has('view')) {
      return;
    }

    const stored = readArchiveView();
    const storedSort = stored.sort ?? DEFAULT_SORT_KEY;
    const updates: Record<string, string | null> = {};

    if (storedSort !== DEFAULT_SORT_KEY) {
      updates.sort = storedSort;
    }
    if (stored.dir && stored.dir !== DEFAULT_SORT_DIR) {
      updates.dir = stored.dir;
    }
    if (stored.view && stored.view !== DEFAULT_VIEW_MODE) {
      updates.view = stored.view;
    }

    if (Object.keys(updates).length > 0) {
      writeParams(updates, 'replace');
    }
  });

  // 見え方が変わったら覚える。次に書架を開いたときの既定値になる。
  useEffect(() => {
    writeArchiveView({sort: sortKey, dir: sortDir, view});
  }, [sortKey, sortDir, view]);

  // 絞り込みを変えると総ページ数が変わるため、条件を触るたびに先頭ページへ戻す。
  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    // 打っている最中は履歴を積まない。空にしたらクエリごと消す。
    writeParams({q: nextQuery.trim() === '' ? null : nextQuery, page: null}, 'replace');
  }

  function toggleTag(tagId: number) {
    const nextTagIds = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];

    writeParams({tags: nextTagIds.length > 0 ? nextTagIds.join(',') : null, page: null});
  }

  function clearFilters() {
    setQuery('');
    writeParams({q: null, tags: null, page: null});
  }

  function changeView(nextView: ViewMode) {
    writeParams({view: nextView === DEFAULT_VIEW_MODE ? null : nextView});
  }

  function changePage(nextPage: number) {
    writeParams({page: nextPage > 0 ? String(nextPage + 1) : null});
  }

  /** 編集を閉じるときは履歴を積まない。積むと、戻るボタンで閉じたはずの編集が開き直す。 */
  function closeEdit() {
    writeParams({edit: null}, 'replace');
  }

  /**
   * 並べ替えの基準を変える。同じ基準をもう一度押したときは昇順・降順を入れ替える。
   * 並びが変わると何ページ目かの意味が変わるため、先頭ページへ戻す。
   */
  function changeSort(nextKey: SortKey) {
    const nextDir: SortDir =
      nextKey === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : DEFAULT_SORT_DIR;

    writeParams({
      sort: nextKey === DEFAULT_SORT_KEY ? null : nextKey,
      dir: nextDir === DEFAULT_SORT_DIR ? null : nextDir,
      page: null,
    });
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
  const hiddenTagCount = tagIndex.length - listedTags.length;

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

          {/* 並べ替え。押している基準をもう一度押すと昇順・降順が入れ替わる。 */}
          <div className="flex border border-line">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => changeSort(option.key)}
                aria-pressed={sortKey === option.key}
                title={
                  sortKey === option.key
                    ? `${option.label}の昇順・降順を入れ替える`
                    : `${option.label}で並べ替える`
                }
                className={`flex items-center gap-1 px-2.5 py-2 text-[11px] transition-colors ${
                  sortKey === option.key ? 'bg-shu/[0.12] text-shu-lit' : 'text-faint hover:text-text'
                }`}
              >
                {option.label}
                {sortKey === option.key && (
                  <span aria-hidden="true" className="font-mono text-[10px]">
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
                <span className="sr-only">
                  {sortKey === option.key ? (sortDir === 'asc' ? '（昇順）' : '（降順）') : ''}
                </span>
              </button>
            ))}
          </div>

          <div className="flex border border-line">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => changeView(mode)}
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
          <div
            className={`mt-3 flex flex-wrap items-center gap-1.5 ${
              showAllTags ? 'max-h-[28vh] overflow-y-auto pr-1' : ''
            }`}
          >
            {listedTags.map((tag) => (
              <TagChip
                key={tag.id}
                name={tag.name}
                count={tag.count}
                isSelected={selectedTagIds.includes(tag.id)}
                onToggle={() => toggleTag(tag.id)}
              />
            ))}

            {tagIndex.length > TAG_COLLAPSED_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllTags((current) => !current)}
                aria-expanded={showAllTags}
                className="ml-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint transition-colors hover:text-text"
              >
                {showAllTags ? '折りたたむ' : `+${hiddenTagCount} 件`}
              </button>
            )}

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
            <li key={bookmark.id} className="h-full">
              <ArchiveCard
                bookmark={bookmark}
                onDelete={handleDelete}
                onEdit={(bookmarkId) => writeParams({edit: String(bookmarkId)})}
                isDeleting={isDeleting}
                selectedTagIds={selectedTagIds}
                onToggleTag={toggleTag}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {pageItems.map((bookmark) => (
            <li key={bookmark.id}>
              <ArchiveRow
                bookmark={bookmark}
                onDelete={handleDelete}
                onEdit={(bookmarkId) => writeParams({edit: String(bookmarkId)})}
                isDeleting={isDeleting}
                selectedTagIds={selectedTagIds}
                onToggleTag={toggleTag}
              />
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
          onPageChange={({selected}) => changePage(selected)}
          containerClassName={'pagination'}
          activeClassName={'active'}
          pageClassName={'page'}
          previousClassName={'previous'}
          nextClassName={'next'}
          disabledClassName={'disabled'}
          forcePage={page}
        />
      )}

      {editing && (
        <EditBookmarkDialog
          bookmark={editing}
          tagSuggestions={tagSuggestions}
          onClose={closeEdit}
        />
      )}
    </div>
  );
}

/** 押すと絞り込みに反映されるタグ片。絞り込み欄と各ブックマークの両方で使う。 */
function TagChip({
  name,
  count,
  isSelected,
  onToggle,
}: {
  name: string;
  count?: number;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isSelected}
      title={isSelected ? `「${name}」の絞り込みを外す` : `「${name}」で絞り込む`}
      className={`chip ${isSelected ? 'chip-on' : 'hover:border-dim hover:text-text'}`}
    >
      {name}
      {count !== undefined && <span className="tnum font-mono text-[10px] opacity-50">{count}</span>}
    </button>
  );
}

/**
 * URL の全文表示とコピー。
 *
 * 省略せずに出すのは、ブックマークを開くためではなく URL 自体を貼り付けたい場面が多いため。
 * select-all を当てているので、コピーボタンが使えない環境でも1クリックで全選択できる。
 */
function BookmarkUrl({url}: {url: string}) {
  const [isCopied, setIsCopied] = useState(false);
  const copiedTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimerRef.current);
  }, []);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setIsCopied(false), 1500);
    } catch {
      // 非 https など Clipboard API が使えない環境では、select-all による手動コピーに委ねる
    }
  }

  return (
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 select-all break-all font-mono text-[10px] leading-[1.7] text-faint">
        {url}
      </p>
      <button
        type="button"
        onClick={copyUrl}
        aria-label="URLをコピー"
        className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
          isCopied ? 'border-gold text-gold' : 'border-line text-faint hover:border-dim hover:text-text'
        }`}
      >
        {isCopied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

/**
 * 一覧に出す日付の書式。時刻は落として日付だけを出す。
 *
 * タイムゾーンを日本時間に固定するのは、この一覧がサーバー側でも描かれるため。
 * 実行環境まかせにすると、サーバー（UTC）とブラウザ（利用者の設定）で日付が
 * 1日ずれ、hydration の不一致になる。
 */
const archiveDateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatArchiveDate(isoTimestamp: string): string {
  return archiveDateFormat.format(new Date(isoTimestamp));
}

/** 1件の追加日と更新日。カードでは横に並べ、一覧形式では列に収めるため縦に積む。 */
function BookmarkDates({
  createdAt,
  updatedAt,
  stacked = false,
}: {
  createdAt: string;
  updatedAt: string;
  stacked?: boolean;
}) {
  return (
    <div
      className={`tnum font-mono text-[10px] leading-[1.7] text-faint ${
        stacked ? 'flex flex-col' : 'flex flex-wrap gap-x-3'
      }`}
    >
      <span>
        追加日 <time dateTime={createdAt}>{formatArchiveDate(createdAt)}</time>
      </span>
      <span>
        更新日 <time dateTime={updatedAt}>{formatArchiveDate(updatedAt)}</time>
      </span>
    </div>
  );
}

type ItemProps = {
  bookmark: Bookmark;
  onDelete: (bookmarkId: number) => void;
  onEdit: (bookmarkId: number) => void;
  isDeleting: boolean;
  selectedTagIds: number[];
  onToggleTag: (tagId: number) => void;
};

/** 一覧の上に重ねる小さな操作ボタン。編集と削除で見た目を揃える。 */
const overlayButtonClass =
  'border border-line bg-ink/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint backdrop-blur-sm transition-colors hover:border-shu hover:text-shu-lit disabled:opacity-40';

function ItemActions({
  bookmark,
  onDelete,
  onEdit,
  isDeleting,
}: Pick<ItemProps, 'bookmark' | 'onDelete' | 'onEdit' | 'isDeleting'>) {
  const name = bookmark.title ?? bookmark.url;

  return (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => onEdit(bookmark.id)}
        aria-label={`「${name}」を編集`}
        className={overlayButtonClass}
      >
        edit
      </button>
      <button
        type="button"
        onClick={() => onDelete(bookmark.id)}
        disabled={isDeleting}
        aria-label={`「${name}」を削除`}
        className={overlayButtonClass}
      >
        del
      </button>
    </div>
  );
}

function ArchiveCard({bookmark, onDelete, onEdit, isDeleting, selectedTagIds, onToggleTag}: ItemProps) {
  return (
    <article className="group relative flex h-full flex-col bg-panel transition-colors duration-300 hover:bg-raise">
      <div className="relative aspect-[16/10] overflow-hidden bg-raise">
        <ThumbnailCarousel
          thumbnails={bookmark.thumbnails}
          sizes="(min-width: 1280px) 24vw, (min-width: 640px) 44vw, 92vw"
        />

        <span className="tnum absolute left-0 top-0 z-10 bg-ink/75 px-2 py-1 font-mono text-[10px] text-faint backdrop-blur-sm">
          {String(bookmark.id).padStart(3, '0')}
        </span>

        <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <ItemActions
            bookmark={bookmark}
            onDelete={onDelete}
            onEdit={onEdit}
            isDeleting={isDeleting}
          />
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

        <BookmarkUrl url={bookmark.url} />

        {bookmark.rating !== null && (
          <div className="flex items-center gap-2">
            <StarRating value={bookmark.rating} size={12} />
            <span className="tnum font-mono text-[10px] text-faint">{bookmark.rating.toFixed(1)}</span>
          </div>
        )}

        <BookmarkDates createdAt={bookmark.createdAt} updatedAt={bookmark.updatedAt} />

        {bookmark.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {bookmark.tags.map((tag) => (
              <TagChip
                key={tag.id}
                name={tag.name}
                isSelected={selectedTagIds.includes(tag.id)}
                onToggle={() => onToggleTag(tag.id)}
              />
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

function ArchiveRow({bookmark, onDelete, onEdit, isDeleting, selectedTagIds, onToggleTag}: ItemProps) {
  const [cover] = bookmark.thumbnails;

  return (
    <article className="group flex items-start gap-4 py-3 transition-colors hover:bg-panel">
      <span className="tnum w-10 shrink-0 pl-1 pt-1 font-mono text-[11px] text-faint">
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
        {bookmark.thumbnails.length > 1 && (
          <span className="tnum absolute bottom-0 right-0 bg-ink/80 px-1 font-mono text-[9px] text-dim">
            {bookmark.thumbnails.length}枚
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          className="block font-display text-[14px] font-semibold leading-snug text-text transition-colors hover:text-shu"
        >
          {bookmark.title || '(無題)'}
        </a>
        <div className="mt-1">
          <BookmarkUrl url={bookmark.url} />
        </div>
      </div>

      <div className="hidden w-[10rem] shrink-0 flex-wrap gap-1 pt-0.5 lg:flex">
        {bookmark.tags.map((tag) => (
          <TagChip
            key={tag.id}
            name={tag.name}
            isSelected={selectedTagIds.includes(tag.id)}
            onToggle={() => onToggleTag(tag.id)}
          />
        ))}
      </div>

      {/* 幅の狭い画面では、タイトルと URL を潰さないために日付の列を落とす。 */}
      <div className="hidden w-[7.5rem] shrink-0 pt-0.5 md:block">
        <BookmarkDates createdAt={bookmark.createdAt} updatedAt={bookmark.updatedAt} stacked />
      </div>

      <div className="hidden w-[6.5rem] shrink-0 items-center gap-2 pt-1 sm:flex">
        {bookmark.rating !== null && (
          <>
            <StarRating value={bookmark.rating} size={11} />
            <span className="tnum font-mono text-[10px] text-faint">{bookmark.rating.toFixed(1)}</span>
          </>
        )}
      </div>

      <div className="shrink-0 pr-1 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <ItemActions
          bookmark={bookmark}
          onDelete={onDelete}
          onEdit={onEdit}
          isDeleting={isDeleting}
        />
      </div>
    </article>
  );
}
