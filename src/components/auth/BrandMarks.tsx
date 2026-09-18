/**
 * Provider brand marks, drawn inline so they stay crisp at any size and never
 * cost a network request.
 *
 * These are the providers' own marks, in their own colours — sign-in buttons are
 * expected to carry them (Google's identity guidelines actually require the
 * four-colour G). Apple and X are single-colour by design: their marks render
 * white on a dark field, which is what `currentColor` resolves to here.
 *
 * Kept byte-identical to sol-zero-engine-mainnet/src/shared/ui/brand/BrandMarks.tsx
 * so both products draw the same marks.
 */

type MarkProps = {
  size?: number
  className?: string
}

export function GoogleMark({ size = 18, className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export function TelegramMark({ size = 18, className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        fill="#ffffff"
        d="M5.49 11.63 17 7.19c.6-.22 1.13.15.93 1.06l-1.96 9.24c-.15.74-.6.92-1.22.57l-3.37-2.48-1.62 1.56c-.18.18-.33.34-.68.34l.24-3.44 6.26-5.66c.27-.24-.06-.38-.42-.14l-7.74 4.87-3.33-1.04c-.73-.23-.74-.73.15-1.09z"
      />
    </svg>
  )
}

export function AppleMark({ size = 18, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M16.36 12.78c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.42-.14-2.76.83-3.48.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.9-3.75 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 2.99.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.41-3.65zM14.09 5.6c.63-.77 1.05-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.09 1.77-.95 2.81 1.02.08 2.05-.52 2.68-1.28z" />
    </svg>
  )
}

export function XMark({ size = 17, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64z" />
    </svg>
  )
}
