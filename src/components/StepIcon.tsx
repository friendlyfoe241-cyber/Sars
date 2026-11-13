import type { StepId } from "../lib/steps";

/** 24 px stroke icons, 1.8 px, round joins (Vortex icon spec). */
export default function StepIcon({ id, size = 22 }: { id: StepId; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (id) {
    case "locate":
      return (
        <svg {...common}>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11z" />
          <circle cx="12" cy="10" r="2.4" />
        </svg>
      );
    case "scenes":
      return (
        <svg {...common}>
          <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
          <path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" />
        </svg>
      );
    case "pairs":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="12" height="12" rx="2.5" />
          <rect x="9" y="9" width="12" height="12" rx="2.5" />
        </svg>
      );
    case "change":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M12 4v16M7 9l2 2-2 2M17 9l-2 2 2 2" />
        </svg>
      );
    case "explain":
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 1 1 3.4 6.5L4 20l1.2-3.4A8 8 0 0 1 4 12z" />
          <path d="M9 10h6M9 13.5h4" />
        </svg>
      );
  }
}
