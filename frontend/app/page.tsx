import { redirect } from 'next/navigation'

// Home is the Companies page (middleware.ts answers "/" first; this is the
// fallback).
export default function HomePage() {
  redirect('/companies')
}
