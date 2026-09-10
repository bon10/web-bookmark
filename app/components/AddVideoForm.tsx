'use client';

import {useActionState, useEffect, useRef, useState, type ChangeEvent} from 'react';
import {addVideo, type ActionResult} from '@/app/actions';

const initialState: ActionResult = {error: null};

export default function AddVideoForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // 送信が成功したときだけフォームとプレビューを初期化する。
  // エフェクトで state を監視すると余分な再レンダリングを挟むため、アクションの中で直接行う。
  async function submit(prevState: ActionResult, formData: FormData): Promise<ActionResult> {
    const result = await addVideo(prevState, formData);
    if (result.error === null) {
      formRef.current?.reset();
      setPreviewUrls([]);
    }
    return result;
  }

  const [state, formAction, pending] = useActionState(submit, initialState);

  // createObjectURL で確保した参照は、プレビューが入れ替わるときとアンマウント時に解放する。
  useEffect(() => {
    return () => {
      for (const url of previewUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [previewUrls]);

  function handleThumbnailChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setPreviewUrls(files.map((file) => URL.createObjectURL(file)));
  }

  return (
    <div className="bg-gray-100 p-8">
      <h2 className="mb-4 text-2xl font-semibold">Webサイトを追加</h2>
      <form ref={formRef} action={formAction} className="flex flex-col space-y-4">
        <input
          type="text"
          name="title"
          required
          placeholder="Webサイトタイトル"
          className="rounded border border-gray-300 p-2"
        />
        <input
          type="url"
          name="video_url"
          required
          placeholder="WebサイトURL"
          className="rounded border border-gray-300 p-2"
        />
        <input
          type="number"
          name="sort_order"
          placeholder="ソート順"
          className="rounded border border-gray-300 p-2"
        />
        <input
          type="number"
          name="rating"
          step="0.1"
          min="1"
          max="5"
          placeholder="評価 (1.0 - 5.0)"
          className="rounded border border-gray-300 p-2"
        />
        <input
          type="file"
          name="thumbnails"
          accept="image/*"
          multiple
          onChange={handleThumbnailChange}
          style={{display: 'none'}}
          ref={thumbnailInputRef}
        />
        <button
          type="button"
          onClick={() => thumbnailInputRef.current?.click()}
          className="rounded bg-blue-500 py-2 px-4 text-white"
        >
          サムネイルを選択
        </button>
        {previewUrls.length > 0 && (
          <div className="flex flex-wrap">
            {previewUrls.map((url) => (
              // アップロード前のローカルプレビューなので next/image は使わない
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="サムネイルのプレビュー" className="mr-2 mb-2 h-20 w-20 object-cover" />
            ))}
          </div>
        )}
        <input
          type="text"
          name="tags"
          placeholder="タグ (複数の場合はカンマ区切り)"
          className="rounded border border-gray-300 p-2"
        />
        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-green-500 py-2 px-4 text-white disabled:opacity-50"
        >
          {pending ? '追加中…' : '追加'}
        </button>
      </form>
    </div>
  );
}
