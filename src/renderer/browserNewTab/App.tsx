import React from 'react'

// The page loaded into a fresh browser tab opened via "+" — deliberately
// blank/neutral rather than auto-navigating to app.silver-tribe.com, so
// opening a new tab doesn't feel like the app pushing its own site on the
// user every time.
export default function App() {
  return (
    <div className="flex items-center justify-center w-full h-full bg-efc-bg select-none">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <svg className="w-8 h-8 text-efc-text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
        </svg>
        <div className="text-[13px] text-efc-text-dim">
          Enter a URL or search above to get started
        </div>
      </div>
    </div>
  )
}
