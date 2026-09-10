import 'server-only';

import {createHash} from 'node:crypto';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

// 内容が変わればキーごと変わる設計なので、期限切れを待つ理由がない。
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const bucketName = process.env.R2_BUCKET_NAME ?? '';

// R2 は S3 互換 API を提供するため AWS SDK をそのまま使う。
// リージョンの概念が無いので 'auto' を渡す。
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

/**
 * サムネイルを R2 に保存し、DB に記録するオブジェクトキーを返す。
 *
 * キーにファイル内容の SHA-256 を使うのは、同名ファイルで差し替えたときに URL が変わらず
 * 古い画像がキャッシュに残り続けるのを防ぐため。元のファイル名は使わない（スペースや
 * 記号がそのまま URL に出るのを避ける意味もある）。
 *
 * @param bookmarkId ブックマークの ID。既存オブジェクトと同じ場所に置くため、
 *   プレフィックスは `thumbnails/<ID>/` のまま変えない。
 */
export async function uploadThumbnail(bookmarkId: number, file: File): Promise<string> {
  const body = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const extension = path.extname(file.name).toLowerCase() || '.jpg';
  const objectKey = `thumbnails/${bookmarkId}/${contentHash}${extension}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: body,
      ContentType: file.type || 'image/jpeg',
      CacheControl: CACHE_CONTROL,
    }),
  );

  return objectKey;
}

/**
 * 指定したブックマークのサムネイルのオブジェクトキーを列挙する。
 * R2 にディレクトリの概念は無く一括削除もできないため、削除前の列挙に使う。
 */
export async function listThumbnailKeys(bookmarkId: number): Promise<string[]> {
  const {Contents} = await r2Client.send(
    new ListObjectsV2Command({Bucket: bucketName, Prefix: `thumbnails/${bookmarkId}/`}),
  );

  return (Contents ?? [])
    .map((object) => object.Key)
    .filter((key): key is string => key !== undefined);
}

export async function deleteThumbnail(objectKey: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({Bucket: bucketName, Key: objectKey}));
}
