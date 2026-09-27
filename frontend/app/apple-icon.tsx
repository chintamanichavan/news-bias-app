import { ImageResponse } from 'next/og'

// Same Artha mark as icon.tsx at home-screen size.

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #312e81 0%, #6d28d9 55%, #be185d 100%)',
        }}
      >
        <svg
          width="132"
          height="132"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fcd34d"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5.5 19.5 L12 4.5 L18.5 19.5" />
          <path d="M8.3 14.4 h1.6 l1.3 -2 l1.5 2.9 l1.3 -1.6 l2.6 -2.5" />
          <circle cx="17.2" cy="10.6" r="1.05" fill="#fcd34d" stroke="none" />
        </svg>
      </div>
    ),
    { ...size },
  )
}
