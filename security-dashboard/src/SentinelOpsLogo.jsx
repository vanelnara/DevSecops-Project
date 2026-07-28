/** SentinelOps mark: transparent lion art + optional wordmark under (no box). */
export default function SentinelOpsLogo({
  size = 64,
  className = '',
  showWordmark = false,
  variant = 'cyber', // 'cyber' | 'teal'
}) {
  const src = variant === 'teal' ? '/sentinelops-lion-teal.png' : '/sentinelops-lion.png';

  const mark = (
    <img
      className={['sentinelops-mark', className].filter(Boolean).join(' ')}
      src={src}
      alt="SentinelOps"
      width={size}
      style={{ width: size, height: 'auto' }}
      draggable={false}
    />
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
