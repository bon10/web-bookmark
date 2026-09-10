/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: process.env.AWS_BUCKET_DOMAIN
      ? [{protocol: 'https', hostname: process.env.AWS_BUCKET_DOMAIN}]
      : [],
  },
  async headers () {
    return [
      {
       source: '/(.*).(jpg|png)',
       headers: [
         {
           key: 'Cache-Control',
           value:
             'public, max-age=300, s-maxage=300', // 5 minutes
         },
       ],
      }
    ]
  },
}

module.exports = nextConfig
