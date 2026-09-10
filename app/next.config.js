/** @type {import('next').NextConfig} */

// サムネイルの配信元。next/image はここに列挙したホストからしか画像を取得しない。
const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
const r2Hostname = r2PublicUrl ? new URL(r2PublicUrl).hostname : undefined

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: r2Hostname ? [{protocol: 'https', hostname: r2Hostname}] : [],
  },
}

module.exports = nextConfig
