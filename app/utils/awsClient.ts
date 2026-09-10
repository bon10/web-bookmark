import 'server-only';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

export const bucketName = process.env.AWS_S3_BUCKET_NAME ?? '';

const SIGNED_URL_TTL_SECONDS = 86400;

/**
 * 署名日時を当日0時に切り捨てる。
 *
 * 署名付きURLは署名日時が変わるたびに別のURLになるため、リクエストごとに署名すると
 * ブラウザキャッシュが毎回外れる。1日1回だけURLが変わるようにして、キャッシュを効かせる。
 * 切り捨てた分だけ有効期限も前倒しになるので、0時をまたぐ直前に発行したURLは寿命が短い。
 */
function getTruncatedSigningDate(): Date {
  const signingDate = new Date();
  signingDate.setHours(0, 0, 0, 0);
  return signingDate;
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function uploadFileToS3(objectKey: string, file: File): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
      ACL: 'private',
    }),
  );
}

export async function s3GetSignedUrl(objectKey: string): Promise<string> {
  return getSignedUrl(s3Client, new GetObjectCommand({Bucket: bucketName, Key: objectKey}), {
    expiresIn: SIGNED_URL_TTL_SECONDS,
    signingDate: getTruncatedSigningDate(),
  });
}

/**
 * 指定ディレクトリ配下のオブジェクトキーを列挙する。
 * S3 にはディレクトリの概念が無く一括削除もできないため、削除前の列挙に使う。
 */
export async function s3ListObjectsInDirectory(directoryPath: string): Promise<string[]> {
  const prefix = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`;
  const {Contents} = await s3Client.send(
    new ListObjectsV2Command({Bucket: bucketName, Prefix: prefix}),
  );

  return (Contents ?? [])
    .map((object) => object.Key)
    .filter((key): key is string => key !== undefined);
}

export async function deleteFromS3(objectKey: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({Bucket: bucketName, Key: objectKey}));
}
