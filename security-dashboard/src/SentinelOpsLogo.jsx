export default function SentinelOpsLogo({ size = 64, className = '', showWordmark = false }) {
  const mark = (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="soShield" x1="12" y1="6" x2="52" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38BDF8" />
          <stop offset="0.55" stopColor="#0EA5E9" />
          <stop offset="1" stopColor="#0369A1" />
        </linearGradient>
        <linearGradient id="soGlow" x1="32" y1="10" x2="32" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E0F2FE" stopOpacity="0.95" />
          <stop offset="1" stopColor="#7DD3FC" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#07131F" stroke="rgba(56,189,248,0.35)" />
      <path
        d="M32 10.5C26.2 14.2 19.8 16 13.5 16.2V31.4C13.5 42.2 21.1 51.4 32 54.5C42.9 51.4 50.5 42.2 50.5 31.4V16.2C44.2 16 37.8 14.2 32 10.5Z"
        fill="url(#soShield)"
      />
      <path
        d="M32 15.2C27.4 18.1 22.2 19.5 17 19.7V31.1C17 39.4 22.9 46.8 32 49.5C41.1 46.8 47 39.4 47 31.1V19.7C41.8 19.5 36.6 18.1 32 15.2Z"
        fill="url(#soGlow)"
        fillOpacity="0.22"
      />
      <circle cx="32" cy="30" r="5.2" fill="#F0F9FF" />
      <circle cx="22.5" cy="36.5" r="2.4" fill="#BAE6FD" />
      <circle cx="41.5" cy="36.5" r="2.4" fill="#BAE6FD" />
      <circle cx="32" cy="41.8" r="2.2" fill="#7DD3FC" />
      <path d="M32 35.2V39.4M27.2 33.4L24.2 35.4M36.8 33.4L39.8 35.4" stroke="#E0F2FE" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M24.8 24.2L29.2 27.4M39.2 24.2L34.8 27.4" stroke="#F0F9FF" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );

  if (!showWordmark) return mark;

  return (
    <div className="sentinelops-brand-block">
      {mark}
      <div className="sentinelops-wordmark">
        <strong>SentinelOps</strong>
        <span>Security Intelligence</span>
      </div>
    </div>
  );
}
