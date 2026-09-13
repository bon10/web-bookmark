// ユビキタス言語: docs/ubiquitous-language.md
// 書架の「見え方」（並べ替えと表示形式）の値と、その記憶を一箇所に集める。
//
// 一覧の状態そのものは URL のクエリを正とする（リロードや戻るで同じ画面に戻すため）。
// このファイルが受け持つのは、**クエリに指定が無いときに使う既定値を利用者ごとに覚えておく**部分。
//
// 絞り込みの語とタグは覚えない。次に開いたときも絞り込まれたままだと、
// 書架から本が消えたように見えてしまうため。

export type SortKey = 'order' | 'created' | 'rating';
export type SortDir = 'asc' | 'desc';
export type ViewMode = 'grid' | 'list';

export const SORT_OPTIONS: {key: SortKey; label: string}[] = [
  {key: 'order', label: '表示順'},
  {key: 'created', label: '追加順'},
  {key: 'rating', label: '評価順'},
];

export const DEFAULT_SORT_KEY: SortKey = 'order';
export const DEFAULT_VIEW_MODE: ViewMode = 'grid';

// テーマの記憶（utils/theme.ts）と同じ命名にそろえる。
export const ARCHIVE_VIEW_STORAGE_KEY = 'tube-bookmark:archive-view';

/**
 * 並べ替えの既定の向き。表示順は自分で付けた番号の小さい方から、
 * 追加順と評価順は「新しい方・高い方を先に見たい」ので降順から始める。
 */
export function defaultDirFor(sortKey: SortKey): SortDir {
  return sortKey === 'order' ? 'asc' : 'desc';
}

/** 読めない値は null。URL にも localStorage にも手で書かれた値が入りうるため、必ず通す。 */
export function parseSortKey(value: unknown): SortKey | null {
  return SORT_OPTIONS.some((option) => option.key === value) ? (value as SortKey) : null;
}

export function parseSortDir(value: unknown): SortDir | null {
  return value === 'asc' || value === 'desc' ? value : null;
}

export function parseViewMode(value: unknown): ViewMode | null {
  return value === 'grid' || value === 'list' ? value : null;
}

export type ArchiveView = {sort: SortKey; dir: SortDir; view: ViewMode};

/**
 * 前回の見え方を読む。値が無い・壊れている項目は落として返す。
 * localStorage に触れない環境（プライベートモード等）でも例外を投げない。
 */
export function readArchiveView(): Partial<ArchiveView> {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_VIEW_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;

    const stored: Partial<ArchiveView> = {};
    const sort = parseSortKey(record.sort);
    const dir = parseSortDir(record.dir);
    const view = parseViewMode(record.view);
    if (sort) {
      stored.sort = sort;
    }
    if (dir) {
      stored.dir = dir;
    }
    if (view) {
      stored.view = view;
    }
    return stored;
  } catch {
    return {};
  }
}

export function writeArchiveView(value: ArchiveView): void {
  try {
    window.localStorage.setItem(ARCHIVE_VIEW_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 記憶できなくても一覧は使えるので、ここでは何もしない。
  }
}
