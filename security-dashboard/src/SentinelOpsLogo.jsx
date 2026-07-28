/** Lion AI mark + optional SentinelOps wordmark */
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
        <linearGradient id="lionMane" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBBF24" />
          <stop offset="0.45" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id="lionFace" x1="22" y1="20" x2="42" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FEF3C7" />
          <stop offset="1" stopColor="#FDE68A" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#0B1220" stroke="rgba(251,191,36,0.4)" />
      {/* mane */}
      <circle cx="32" cy="33" r="22" fill="url(#lionMane)" />
      <circle cx="14" cy="24" r="7" fill="#D97706" opacity="0.85" />
      <circle cx="50" cy="24" r="7" fill="#D97706" opacity="0.85" />
      <circle cx="18" cy="44" r="6.5" fill="#B45309" opacity="0.9" />
      <circle cx="46" cy="44" r="6.5" fill="#B45309" opacity="0.9" />
      <circle cx="32" cy="14" r="7" fill="#F59E0B" />
      {/* face */}
      <ellipse cx="32" cy="34" rx="14" ry="15" fill="url(#lionFace)" />
      {/* eyes */}
      <ellipse cx="26.5" cy="31" rx="2.2" ry="2.6" fill="#0F172A" />
      <ellipse cx="37.5" cy="31" rx="2.2" ry="2.6" fill="#0F172A" />
      <circle cx="27.2" cy="30.2" r="0.7" fill="#FFF7ED" />
      <circle cx="38.2" cy="30.2" r="0.7" fill="#FFF7ED" />
      {/* nose / muzzle */}
      <ellipse cx="32" cy="38.5" rx="4.2" ry="3.2" fill="#F59E0B" />
      <path d="M30.2 37.6c.5-.7 1.3-1.1 1.8-1.1s1.3.4 1.8 1.1" stroke="#92400E" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M32 39.2v3.2M32 42.4c-1.6 1.4-3.4 1.6-4.6 1.2M32 42.4c1.6 1.4 3.4 1.6 4.6 1.2" stroke="#92400E" strokeWidth="1.15" strokeLinecap="round" />
      {/* ears */}
      <path d="M21 22.5l-3.2-5.5 6.2 2.2z" fill="#FBBF24" stroke="#B45309" strokeWidth="0.8" />
      <path d="M43 22.5l3.2-5.5-6.2 2.2z" fill="#FBBF24" stroke="#B45309" strokeWidth="0.8" />
      {/* AI spark */}
      <circle cx="48" cy="14" r="5.2" fill="#0EA5E9" stroke="#E0F2FE" strokeWidth="1.2" />
      <path d="M48 11.4v5.2M45.4 14h5.2" stroke="#F0F9FF" strokeWidth="1.4" strokeLinecap="round" />
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
