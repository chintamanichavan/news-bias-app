import { NextRequest, NextResponse } from 'next/server'

const ML_SERVICE = process.env.ML_SERVICE_URL ?? 'http://localhost:8421'

async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname.replace('/api', '')
  const url = ML_SERVICE + path + req.nextUrl.search

  const headers = new Headers(req.headers)
  headers.delete('host')

  const init: RequestInit = {
    method: req.method,
    headers,
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  try {
    const res = await fetch(url, init)
    const body = await res.arrayBuffer()
    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'ML service unavailable' }, { status: 503 })
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const DELETE = proxy
