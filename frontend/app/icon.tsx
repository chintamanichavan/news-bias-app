import { ImageResponse } from 'next/og'

// The Artha mark: an "A" whose crossbar is a rising signal that breaks
// through the right leg — gold on deep indigo→magenta, wealth out of signal.

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          borderRadius: 6,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fcd34d"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5.5 19.5 L12 4.5 L18.5 19.5" />
          <path d="M8.3 14.4 h1.6 l1.3 -2 l1.5 2.9 l1.3 -1.6 l2.6 -2.5" />
          <circle cx="17.2" cy="10.6" r="1.15" fill="#fcd34d" stroke="none" />
        </svg>
      </div>
    ),
    { ...size },
  )
}
