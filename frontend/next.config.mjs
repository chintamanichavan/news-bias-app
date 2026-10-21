/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  // The icon used to live at these addresses. A phone holding an old copy of
  // a page still asks for them, and with nothing there iOS draws a plain
  // letter "A" instead. Answer with the current icon.
  async rewrites() {
    return [
      { source: '/apple-icon', destination: '/apple-touch-icon.png' },
      { source: '/icon', destination: '/icon2.png' },
      { source: '/icon/:size', destination: '/icon2.png' },
    ]
  },
}

export default nextConfig
