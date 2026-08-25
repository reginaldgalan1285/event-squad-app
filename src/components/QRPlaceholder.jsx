import { useMemo } from "react";

// Deterministic pseudo-random grid so it visually reads as a QR code.
// This is a stand-in — see README for wiring up a real payment-gateway QR.
export default function QRPlaceholder({ seed = 7, size = 21 }) {
  const cells = useMemo(() => {
    let s = seed;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    const grid = [];
    for (let i = 0; i < size * size; i++) grid.push(rand() > 0.56);
    return grid;
  }, [seed, size]);

  return (
    <svg width={160} height={160} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <rect width={size} height={size} fill="#ffffff" />
      {cells.map((on, i) => {
        if (!on) return null;
        const x = i % size;
        const y = Math.floor(i / size);
        return <rect key={i} x={x} y={y} width={1} height={1} fill="#16233a" />;
      })}
      {[[0, 0], [size - 7, 0], [0, size - 7]].map(([fx, fy], idx) => (
        <g key={idx}>
          <rect x={fx} y={fy} width={7} height={7} fill="#ffffff" stroke="#16233a" strokeWidth={1} />
          <rect x={fx + 2} y={fy + 2} width={3} height={3} fill="#16233a" />
        </g>
      ))}
    </svg>
  );
}
