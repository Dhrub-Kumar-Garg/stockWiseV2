"use client";

/**
 * Sakura — 16 falling petals with deterministic positioning (SSR-safe).
 * Mascot  — a cute lavender robot face, mood-reactive (happy / asleep).
 */

// ── Sakura petals ──────────────────────────────────────────────────────────

/** Seeded pseudo-random (Mulberry32) so server and client produce the same petals. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Sakura() {
  const rng = seeded(42);
  const petals = Array.from({ length: 16 }, (_, i) => ({
    left: `${rng() * 100}%`,
    animationDuration: `${6 + rng() * 10}s`,
    animationDelay: `${rng() * 12}s`,
    width: `${10 + rng() * 10}px`,
    height: `${10 + rng() * 10}px`,
    opacity: 0.5 + rng() * 0.4,
  }));

  return (
    <>
      {petals.map((s, i) => (
        <div
          key={i}
          className="petal"
          style={{
            left: s.left,
            animationDuration: s.animationDuration,
            animationDelay: s.animationDelay,
            width: s.width,
            height: s.height,
          }}
        />
      ))}
    </>
  );
}

// ── Mascot (lavender robot face) ───────────────────────────────────────────

interface MascotProps {
  size?: number;
  mood?: "happy" | "asleep";
}

export function Mascot({ size = 120, mood = "happy" }: MascotProps) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  const headR = s * 0.38;

  // Eye positions
  const eyeY = cy - headR * 0.08;
  const eyeLx = cx - headR * 0.32;
  const eyeRx = cx + headR * 0.32;
  const eyeR = headR * 0.12;

  // Mouth
  const mouthY = cy + headR * 0.28;

  // Blush
  const blushY = cy + headR * 0.12;
  const blushLx = cx - headR * 0.52;
  const blushRx = cx + headR * 0.52;
  const blushR = headR * 0.14;

  // Antenna
  const antY = cy - headR - headR * 0.18;
  const antBallR = headR * 0.11;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      className="floaty"
      style={{ display: "block" }}
    >
      {/* Antenna stem */}
      <line
        x1={cx}
        y1={cy - headR + 2}
        x2={cx}
        y2={antY}
        stroke="#cdcaeb"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {/* Antenna ball (sakura pink) */}
      <circle cx={cx} cy={antY - antBallR * 0.4} r={antBallR} fill="#ff9eaa">
        <animate
          attributeName="r"
          values={`${antBallR};${antBallR * 1.25};${antBallR}`}
          dur="2.6s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Head */}
      <circle
        cx={cx}
        cy={cy}
        r={headR}
        fill="#cdcaeb"
        stroke="#b0aed4"
        strokeWidth={1.6}
      />

      {/* Face screen */}
      <rect
        x={cx - headR * 0.58}
        y={cy - headR * 0.42}
        width={headR * 1.16}
        height={headR * 0.82}
        rx={headR * 0.2}
        fill="#3d3a5c"
      />

      {/* Eyes */}
      {mood === "happy" ? (
        <>
          {/* Glowing bright eyes */}
          <circle cx={eyeLx} cy={eyeY} r={eyeR} fill="#a8f5d0">
            <animate
              attributeName="opacity"
              values="1;0.6;1"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx={eyeRx} cy={eyeY} r={eyeR} fill="#a8f5d0">
            <animate
              attributeName="opacity"
              values="1;0.6;1"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      ) : (
        <>
          {/* Sleeping eyes — closed curves */}
          <path
            d={`M ${eyeLx - eyeR} ${eyeY} Q ${eyeLx} ${eyeY + eyeR * 1.2} ${eyeLx + eyeR} ${eyeY}`}
            fill="none"
            stroke="#9ecfba"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
          <path
            d={`M ${eyeRx - eyeR} ${eyeY} Q ${eyeRx} ${eyeY + eyeR * 1.2} ${eyeRx + eyeR} ${eyeY}`}
            fill="none"
            stroke="#9ecfba"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </>
      )}

      {/* Smile */}
      <path
        d={`M ${cx - headR * 0.18} ${mouthY} Q ${cx} ${mouthY + headR * 0.15} ${cx + headR * 0.18} ${mouthY}`}
        fill="none"
        stroke="#a8f5d0"
        strokeWidth={1.6}
        strokeLinecap="round"
      />

      {/* Blush */}
      <circle cx={blushLx} cy={blushY} r={blushR} fill="#ff9eaa" opacity={0.45} />
      <circle cx={blushRx} cy={blushY} r={blushR} fill="#ff9eaa" opacity={0.45} />
    </svg>
  );
}
