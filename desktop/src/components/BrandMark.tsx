export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="MyBillBook Desktop">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M6.5 8.75 16 4l9.5 4.75v14.5L16 28l-9.5-4.75V8.75Z" fill="currentColor" opacity=".22" />
          <path d="M6.5 8.75 16 13.5l9.5-4.75M16 13.5V28" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" />
          <path d="M11 17.2h4.2M11 21h7.2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        </svg>
      </span>
      {!compact ? (
        <span>
          <strong>MyBillBook</strong>
          <small>Desktop Companion</small>
        </span>
      ) : null}
    </div>
  )
}
