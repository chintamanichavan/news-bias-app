import { redirect } from 'next/navigation'

// Home is the Companies page (middleware.ts answers "/" first; this is the
// fallback). The sentiment engine that used to live here is a secondary
// input, not the front door.
export default function HomePage() {
  redirect('/companies')
}
