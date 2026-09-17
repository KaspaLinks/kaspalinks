import type { ReactNode } from "react";

// Line icons in the same 24px / 1.6 stroke style as the /new-link type icons.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="escrow-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export function LockIcon() {
  return (
    <Icon>
      <rect height="11" rx="2" width="16" x="4" y="10" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

export function LinkIcon() {
  return (
    <Icon>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </Icon>
  );
}

export function PackageIcon() {
  return (
    <Icon>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <polyline points="5 13 10 18 19 7" />
    </Icon>
  );
}

export function ClockIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </Icon>
  );
}

export function PauseIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <line x1="10" x2="10" y1="9" y2="15" />
      <line x1="14" x2="14" y1="9" y2="15" />
    </Icon>
  );
}

export function SplitIcon() {
  return (
    <Icon>
      <path d="M12 3v7M12 10l-6 6M12 10l6 6" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </Icon>
  );
}

export function KeyIcon() {
  return (
    <Icon>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M14 9l2 2" />
    </Icon>
  );
}

export function ImageIcon() {
  return (
    <Icon>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </Icon>
  );
}
