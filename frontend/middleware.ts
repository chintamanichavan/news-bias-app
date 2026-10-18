import { NextResponse, type NextRequest } from 'next/server'

// Home is the Companies page. Answered here, before any page renders,
// because the app's loading screen would otherwise start streaming first
// and turn the redirect into a client-side one.
export function middleware(req: NextRequest) {
  return NextResponse.redirect(new URL('/companies', req.url), 307)
}

export const config = { matcher: '/' }
