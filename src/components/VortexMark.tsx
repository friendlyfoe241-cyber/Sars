import { useId } from "react";

/** Three orbits drawn inward to a core. Decorative unless a label is given. */
export default function VortexMark({ size = 32, label }: { size?: number; label?: string }) {
  const gid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A5E4FF" />
          <stop offset=".5" stopColor="#6C7BFF" />
          <stop offset="1" stopColor="#9D74F0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gid})`} strokeWidth="5" strokeLinecap="round">
        <path d="M32 6 A26 26 0 1 1 9.48 45" />
        <path d="M47.59 41 A18 18 0 1 1 32 14" />
        <path d="M23.34 37 A10 10 0 1 1 40.66 37" />
      </g>
      <circle cx="32" cy="32" r="3.2" fill="#E6F1FF" />
    </svg>
  );
}
