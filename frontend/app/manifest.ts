import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Artha — Systematic Markets Research',
    short_name: 'Artha',
    description:
      'Quant research platform: validated signals, gated paper trading, and long-horizon business analysis across global markets.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#312e81',
    icons: [
      { src: '/icon1.png', sizes: '32x32', type: 'image/png' },
      { src: '/icon2.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
