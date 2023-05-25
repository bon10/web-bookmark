/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [process.env.AWS_BUCKET_DOMAIN],
    //domains: ['production-tube-bookmark-bucket.s3.ap-northeast-1.amazonaws.com'],
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
