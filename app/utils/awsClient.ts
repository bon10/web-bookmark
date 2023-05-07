// awsClient.ts
import {S3Client} from "@aws-sdk/client-s3";
import {PutObjectCommand} from "@aws-sdk/client-s3";
import {GetObjectCommand} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";


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
async function s3GetSignedUrl(bucketName, filePath, expiresIn = 900) {
  const getObjectParams = {
    Bucket: bucketName,
    Key: filePath,
  };

  const getObjectCommand = new GetObjectCommand(getObjectParams);

  try {
    const signedUrl = await getSignedUrl(s3Client, getObjectCommand, {expiresIn: expiresIn});
    return signedUrl;
  } catch (error) {
    console.error("署名付きURLの取得に失敗しました:", error);
    return null;
  }
}

export {s3Client, uploadFileToS3};
