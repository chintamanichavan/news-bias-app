'use client'

// The printable tear sheet: one company on one page, nothing else on it.

import TearSheet from '@/components/terminal/views/TearSheet'

export default function TearPage({ params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent(params.symbol).toUpperCase()
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 print:p-0 print:max-w-none">
      <button onClick={() => window.print()}
        className="print:hidden mb-4 text-[12px] px-3 py-1 rounded-md bg-foreground text-background">
        Print or save as PDF
      </button>
      <TearSheet symbol={symbol} />
    </div>
  )
}
