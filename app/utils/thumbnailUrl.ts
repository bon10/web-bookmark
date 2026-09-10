const publicBaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '';

/**
 * DB に保存しているオブジェクトキーから、配信用の公開URLを組み立てる。
 *
 * キーにはファイル内容のハッシュが含まれるため、画像を差し替えない限りこのURLは変わらない。
 * R2 側で immutable を返しているので、変わらない間はブラウザも Next の画像キャッシュも再取得しない。
 */
export function thumbnailUrl(objectKey: string): string {
  return `${publicBaseUrl}/${objectKey}`;
}
