'use client';

// ユビキタス言語: docs/ubiquitous-language.md
// 「ブックマーク（Bookmark）」1件を書き換えるフォーム。書架の上に重ねて出す。

import {useActionState, useEffect, useState} from 'react';
import Image from 'next/image';
import {editBookmark, type ActionResult} from '@/app/actions';
import StarRatingInput from '@/components/StarRatingInput';
import TagInput from '@/components/TagInput';
import ThumbnailDropzone from '@/components/ThumbnailDropzone';
import type {Bookmark} from '@/components/BookmarkArchive';

const initialState: ActionResult = {error: null};

/**
 * @param bookmark 書き換える対象。初期値として使う。
 * @param tagSuggestions タグ候補。登録フォームと同じ母集合を渡す。
 * @param onClose 閉じる操作。保存が成功したときにも呼ぶ。
 */
export default function EditBookmarkDialog({
  bookmark,
  tagSuggestions,
  onClose,
}: {
  bookmark: Bookmark;
  tagSuggestions: string[];
  onClose: () => void;
}) {
  // 外すと決めたサムネイルの id。保存するまでは消さず、印だけ付けておく。
  const [removedThumbnailIds, setRemovedThumbnailIds] = useState<number[]>([]);

  async function submit(prevState: ActionResult, formData: FormData): Promise<ActionResult> {
    const result = await editBookmark(prevState, formData);
    if (result.error === null) {
      onClose();
    }
    return result;
  }

  const [state, formAction, pending] = useActionState(submit, initialState);

  // Esc で閉じる。保存中は閉じない（送信の途中で画面を畳むと結果が読めない）。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pending]);

  function toggleThumbnail(thumbnailId: number) {
    setRemovedThumbnailIds((current) =>
      current.includes(thumbnailId)
        ? current.filter((id) => id !== thumbnailId)
        : [...current, thumbnailId],
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`「${bookmark.title ?? bookmark.url}」を編集`}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm sm:p-8"
    >
      {/* 枠の外を押しても閉じる。保存中は閉じない。 */}
      <button
        type="button"
        aria-label="編集を閉じる"
        onClick={() => !pending && onClose()}
        className="absolute inset-0 cursor-default"
      />

      <div className="relative w-full max-w-[520px] border border-line bg-panel">
        <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-[17px] font-semibold tracking-[0.06em]">
            書架の1冊を直す
          </h2>
          <span className="tnum font-mono text-[10px] text-faint">
            {String(bookmark.id).padStart(3, '0')}
          </span>
        </header>

        <form action={formAction} className="flex flex-col gap-6 p-5">
          <input type="hidden" name="id" value={bookmark.id} />

          <label className="block">
            <span className="kicker">Title</span>
            <input
              type="text"
              name="title"
              required
              defaultValue={bookmark.title ?? ''}
              className="field mt-2.5"
            />
          </label>

          <label className="block">
            <span className="kicker">URL</span>
            <input
              type="url"
              name="url"
              required
              defaultValue={bookmark.url}
              className="field mt-2.5 font-mono text-[12px]"
            />
          </label>

          <StarRatingInput name="rating" defaultValue={bookmark.rating ?? 0} />

          <TagInput
            name="tags"
            suggestions={tagSuggestions}
            defaultTags={bookmark.tags.map((tag) => tag.name)}
          />

          {bookmark.thumbnails.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="kicker">納めてあるサムネイル</span>
                {removedThumbnailIds.length > 0 && (
                  <span className="tnum font-mono text-[10px] text-shu-lit">
                    {removedThumbnailIds.length} 枚を外す
                  </span>
                )}
              </div>

              <ul className="mt-2.5 grid grid-cols-4 gap-2">
                {bookmark.thumbnails.map((thumbnail) => {
                  const isRemoved = removedThumbnailIds.includes(thumbnail.id);
                  return (
                    <li key={thumbnail.id}>
                      <button
                        type="button"
                        onClick={() => toggleThumbnail(thumbnail.id)}
                        aria-pressed={isRemoved}
                        aria-label={isRemoved ? 'このサムネイルを残す' : 'このサムネイルを外す'}
                        className={`relative block aspect-square w-full overflow-hidden border transition-colors ${
                          isRemoved ? 'border-shu opacity-35' : 'border-line hover:border-dim'
                        }`}
                      >
                        <Image
                          src={thumbnail.url}
                          alt=""
                          fill
                          sizes="120px"
                          className="object-cover"
                        />
                        {isRemoved && (
                          <span className="absolute inset-0 grid place-items-center bg-ink/70 text-lg leading-none text-shu-lit">
                            ×
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-2 text-[11px] text-faint">
                押すと「外す」印が付きます。保存するまでは消えません。
              </p>

              {removedThumbnailIds.map((thumbnailId) => (
                <input
                  key={thumbnailId}
                  type="hidden"
                  name="removed_thumbnails"
                  value={thumbnailId}
                />
              ))}
            </div>
          )}

          <ThumbnailDropzone name="thumbnails" />

          <label className="block">
            <span className="kicker">Sort order</span>
            <input
              type="number"
              name="sort_order"
              defaultValue={bookmark.sortOrder}
              className="field tnum mt-2.5 font-mono"
            />
          </label>

          {state.error && (
            <p role="alert" className="notice notice-error">
              {state.error}
            </p>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn btn-shu flex-1">
              {pending ? (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse-shu bg-white" />
                  保存中
                </>
              ) : (
                '保存する'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="btn btn-ghost px-4"
            >
              やめる
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
