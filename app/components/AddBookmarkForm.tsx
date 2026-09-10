'use client';

// ユビキタス言語: docs/ubiquitous-language.md
// 「ブックマーク（Bookmark）」を1件登録するフォーム。

import {useActionState, useState} from 'react';
import {addBookmark, type ActionResult} from '@/app/actions';
import StarRatingInput from '@/components/StarRatingInput';
import TagInput from '@/components/TagInput';
import ThumbnailDropzone from '@/components/ThumbnailDropzone';

const initialState: ActionResult = {error: null};

/**
 * @param tagSuggestions 既存タグ名。TagInput の候補として使う。
 */
export default function AddBookmarkForm({tagSuggestions}: {tagSuggestions: string[]}) {
  // 評価・タグ・サムネイルは自前の state を持つため form.reset() では戻らない。
  // 送信成功のたびにこの値を進め、key として渡してマウントし直すことで初期化する。
  const [formGeneration, setFormGeneration] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // 成功時だけフォームを初期化する。エフェクトで state を監視すると
  // 余分な再レンダリングを挟むため、アクションの中で直接行う。
  async function submit(prevState: ActionResult, formData: FormData): Promise<ActionResult> {
    const result = await addBookmark(prevState, formData);
    if (result.error === null) {
      setFormGeneration((generation) => generation + 1);
      setSavedAt(Date.now());
    }
    return result;
  }

  const [state, formAction, pending] = useActionState(submit, initialState);

  return (
    <div className="border border-line bg-panel/60 backdrop-blur-sm">
      <header className="flex items-baseline justify-between border-b border-line px-5 py-4">
        <h2 className="font-display text-[17px] font-semibold tracking-[0.06em]">書架に納める</h2>
        <span className="kicker">New</span>
      </header>

      <form key={formGeneration} action={formAction} className="flex flex-col gap-6 p-5">
        <label className="block">
          <span className="kicker">Title</span>
          <input type="text" name="title" required placeholder="タイトル" className="field mt-2.5" />
        </label>

        <label className="block">
          <span className="kicker">URL</span>
          <input
            type="url"
            name="url"
            required
            placeholder="https://"
            className="field mt-2.5 font-mono text-[12px]"
          />
        </label>

        <StarRatingInput name="rating" />

        <TagInput name="tags" suggestions={tagSuggestions} />

        <ThumbnailDropzone name="thumbnails" />

        <label className="block">
          <span className="kicker">Sort order</span>
          <input
            type="number"
            name="sort_order"
            placeholder="0"
            className="field tnum mt-2.5 font-mono"
          />
        </label>

        {state.error && (
          <p role="alert" className="notice notice-error">
            {state.error}
          </p>
        )}

        {savedAt !== null && state.error === null && !pending && (
          <p key={savedAt} role="status" className="notice notice-done animate-rise">
            納めました。
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-shu w-full">
          {pending ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse-shu bg-white" />
              保存中
            </>
          ) : (
            '追加する'
          )}
        </button>
      </form>
    </div>
  );
}
