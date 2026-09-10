'use client';

import {useCallback, useEffect, useRef, useState, type DragEvent} from 'react';

type Draft = {
  key: string;
  file: File;
  previewUrl: string;
};

let draftSequence = 0;

function toImageFiles(fileList: FileList | null | undefined): File[] {
  return Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/') && file.size > 0);
}

/**
 * サムネイルの入力欄。ファイル選択・ドラッグ&ドロップ・クリップボードからの貼り付けの
 * どれでも追加でき、送信時は隠し input[type=file] 経由で Server Action に渡る。
 *
 * React の state だけでは FormData に file が載らないため、選択内容が変わるたびに
 * DataTransfer で FileList を組み立て直して input.files に書き戻している。
 */
export default function ThumbnailDropzone({name}: {name: string}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteFlash, setPasteFlash] = useState(false);
  const pasteFlashTimerRef = useRef<number | undefined>(undefined);

  // アンマウント時に objectURL を解放するため、最新の drafts を ref にも控える（更新は下の同期エフェクト内）。
  // drafts を依存に持つクリーンアップにすると、1枚追加するたびに表示中の URL まで revoke してしまう。
  const draftsRef = useRef<Draft[]>([]);

  // objectURL の発行と解放は更新関数の外で行う。StrictMode は更新関数を二重に呼ぶため、
  // 中で副作用を起こすと解放されない URL が残る。
  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) {
      return;
    }
    const added = files.map((file) => ({
      key: `draft-${(draftSequence += 1)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setDrafts((current) => [...current, ...added]);
  }, []);

  function removeDraft(key: string) {
    const target = drafts.find((draft) => draft.key === key);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
    }
    setDrafts((current) => current.filter((draft) => draft.key !== key));
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(pasteFlashTimerRef.current);
      for (const draft of draftsRef.current) {
        URL.revokeObjectURL(draft.previewUrl);
      }
    };
  }, []);

  // 選択内容を隠し input に反映する。DataTransfer が使えない環境では
  // 画像を送れないため、その場合はファイル選択のみに機能を落とす。
  useEffect(() => {
    draftsRef.current = drafts;

    const input = fileInputRef.current;
    if (!input) {
      return;
    }
    try {
      const transfer = new DataTransfer();
      for (const draft of drafts) {
        transfer.items.add(draft.file);
      }
      input.files = transfer.files;
    } catch {
      // 何もしない（input.files は直前の選択のまま）
    }
  }, [drafts]);

  // ページのどこで貼り付けても拾う。画像を含まない貼り付けは素通しするので、
  // テキスト入力中の通常のペーストを妨げない。
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const images = toImageFiles(event.clipboardData?.files);
      if (images.length === 0) {
        return;
      }
      event.preventDefault();
      addFiles(images);
      setPasteFlash(true);
      window.clearTimeout(pasteFlashTimerRef.current);
      pasteFlashTimerRef.current = window.setTimeout(() => setPasteFlash(false), 900);
    }

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [addFiles]);

  // ドロップ枠の外に画像を落としたときに、ブラウザがその画像へ遷移するのを止める。
  useEffect(() => {
    function swallow(event: Event) {
      event.preventDefault();
    }
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    addFiles(toImageFiles(event.dataTransfer.files));
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="kicker">Thumbnails</span>
        {drafts.length > 0 && (
          <span className="tnum font-mono text-[10px] text-faint">{drafts.length} 枚</span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        name={name}
        accept="image/*"
        multiple
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          addFiles(toImageFiles(event.target.files));
          // 同じファイルを続けて選び直せるよう、取り込んだら input 自体は空に戻す。
          // （files は直後の useEffect が drafts から組み立て直す）
          event.target.value = '';
        }}
      />

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDragging(false);
          }
        }}
        onDrop={handleDrop}
        className={`mt-2.5 border border-dashed p-4 transition-colors duration-200 ${
          isDragging
            ? 'border-shu bg-shu/[0.09]'
            : pasteFlash
              ? 'border-gold/70 bg-gold/[0.07]'
              : 'border-line bg-raise/40'
        }`}
      >
        {drafts.length > 0 && (
          <ul className="mb-4 grid grid-cols-4 gap-2">
            {drafts.map((draft) => (
              <li key={draft.key} className="group relative aspect-square overflow-hidden border border-line">
                {/* アップロード前のローカルプレビューなので next/image は使わない */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draft.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeDraft(draft.key)}
                  aria-label="このサムネイルを外す"
                  className="absolute inset-0 grid place-items-center bg-ink/80 text-lg leading-none text-shu-lit opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="text-center">
          <p className="text-[12px] leading-relaxed text-dim">
            {isDragging ? (
              <span className="text-shu-lit">ここに落として追加</span>
            ) : (
              <>
                画像をドラッグ&ドロップ、または
                <kbd className="mx-1 border border-line px-1 py-px font-mono text-[10px] text-faint">
                  ⌘V
                </kbd>
                <span className="text-faint">/</span>
                <kbd className="mx-1 border border-line px-1 py-px font-mono text-[10px] text-faint">
                  Ctrl+V
                </kbd>
                で貼り付け
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-ghost mt-3 px-3 py-1.5 text-[12px]"
          >
            ファイルを選ぶ
          </button>
        </div>
      </div>
    </div>
  );
}
