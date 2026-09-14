/** @type {import('next').NextConfig} */

// サムネイルの配信元。next/image はここに列挙したホストからしか画像を取得しない。
const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
const r2Hostname = r2PublicUrl ? new URL(r2PublicUrl).hostname : undefined

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: r2Hostname ? [{protocol: 'https', hostname: r2Hostname}] : [],
  },
  experimental: {
    serverActions: {
      // Server Action の本文は既定 1MB で打ち切られる。サムネイルは1枚 700KB 程度になることが
      // あり、既定のままでは2枚目で登録・編集が失敗する。
      //
      // ここはアプリの規則より一回り大きい値にする。アプリ側の上限
      // （app/utils/bookmarks.ts の MAX_TOTAL_THUMBNAIL_BYTES = 15MB）に先に引っかかって、
      // 理由の分かるエラーが返るようにするため。差分はフォームの他の項目と multipart の
      // 包みの分。**この値を変えるときは同ファイルの上限も合わせること。**
      bodySizeLimit: '16mb',
    },
  },
}

module.exports = nextConfig
