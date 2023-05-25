// awsClient.ts
import {S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import tk from "timekeeper";

// 署名付きURLのキャッシュを有効化するための時間の設定
// round the time to the last 10-minute mark
// const getTruncatedTime = (): Date => {
//   const currentTime = new Date();
//   const d = new Date(currentTime);

//   d.setMinutes(Math.floor(d.getMinutes() / 10) * 10);
//   d.setSeconds(0);
//   d.setMilliseconds(0);

//   return d;
// };
// 24時間で切り捨てる。24時間変わるタイミングでキャッシュが切れるので、タイミングによってはエラーになるかもしれない
const getTruncatedTime = (): Date => {
  const currentTime = new Date();
  const d = new Date(currentTime);

  d.setHours(0);
  d.setMinutes(0);
  d.setSeconds(0);
  d.setMilliseconds(0);

  return d;
};


// S3クライアントの初期化
const s3Client = new S3Client({
  region: process.env.NEXT_PUBLIC_AWS_REGION || "your-region",
  credentials: {
    accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID || "your-access-key-id",
    secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY || "your-secret-access-key",
  },
});

// ファイルをアップロードする関数
async function uploadFileToS3(bucketName, filePath, file) {
  const putObjectParams = {
    Bucket: bucketName,
    Key: filePath, // バケット内のファイルパス
    Body: file, // アップロードするファイル
    ContentType: file.type, // Content-Typeを設定
    ACL: "private" // アクセス権限を指定（オプション）
  };

  const putObjectCommand = new PutObjectCommand(putObjectParams);

  try {
    const uploadResult = await s3Client.send(putObjectCommand);
    console.log("ファイルのアップロードに成功しました:", uploadResult);
  } catch (error) {
    console.error("ファイルのアップロードに失敗しました:", error);
    throw error;
  }
}


// 署名付きURLを取得する関数
// 24時間キャッシュする
async function s3GetSignedUrl(bucketName, filePath, expiresIn = 86400) {
  const getObjectParams = {
    Bucket: bucketName,
    Key: filePath,
  };

  const getObjectCommand = new GetObjectCommand(getObjectParams);

  try {
    //const signedUrl = await getSignedUrl(s3Client, getObjectCommand, {expiresIn: expiresIn});
    //console.log("署名付きURLの取得に成功しました:", signedUrl)

    const signedUrl = tk.withFreeze(getTruncatedTime(), async () => {
      const presignedUrl = await getSignedUrl(s3Client, getObjectCommand, {expiresIn: expiresIn});
      console.log("署名付きURLの取得に成功しました:", presignedUrl)
      return presignedUrl;
    });
    // const tk = require("timekeeper");
    // const signedUrl = await tk.withFreeze(getTruncatedTime(), () => {
    //   getSignedUrl(s3Client, getObjectCommand, {expiresIn: expiresIn});
    //   console.log("署名付きURLの取得に成功しました:", signedUrl)
    // });

    return signedUrl;
  } catch (error) {
    console.error("署名付きURLの取得に失敗しました:", error);
    return null;
  }
}

/**
 * Lists all objects in the specified directory in S3.
 * @param bucketName The name of the S3 bucket.
 * @param directoryPath The path of the directory in the S3 bucket.
 * @returns An array of object keys for the objects in the specified directory.
 */
export async function s3ListObjectsInDirectory(bucketName: string, directoryPath: string): Promise<string[]> {
  const listObjectsParams = {
    Bucket: bucketName,
    Prefix: directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`,
  };

  const listObjectsCommand = new ListObjectsV2Command(listObjectsParams);
  const {Contents: objects} = await s3Client.send(listObjectsCommand);
  const objectKeys = objects
    ? objects
      .map((object) => object.Key)
      .filter((key): key is string => key !== undefined)
    : [];
  return objectKeys;
}

/**
 * Deletes the specified object from S3.
 * @param bucketName The name of the S3 bucket.
 * @param objectKey The object key of the object to delete.
 * @returns A promise that resolves when the object is deleted.
 */
export async function deleteFromS3(bucketName: string, objectKey: string): Promise<void> {
  const deleteObjectParams = {
    Bucket: bucketName,
    Key: objectKey,
  };

  const deleteObjectCommand = new DeleteObjectCommand(deleteObjectParams);
  await s3Client.send(deleteObjectCommand);
  console.log(`Deleted object ${objectKey} from bucket ${bucketName}`);
}

export {s3Client, uploadFileToS3, s3GetSignedUrl};
