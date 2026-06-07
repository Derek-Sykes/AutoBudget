import type { SVGProps } from "react";

// Lightweight inline icons (no dependency). Inherit color via currentColor.
function Svg({ className = "h-5 w-5", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    />
  );
}

export function WalletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H17a2 2 0 0 1 2 2" />
      <path d="M3 8.5V17a2.5 2.5 0 0 0 2.5 2.5H18.5A1.5 1.5 0 0 0 20 18v-6a1.5 1.5 0 0 0-1.5-1.5H5.5A2.5 2.5 0 0 1 3 8.5Z" />
      <circle cx="16" cy="14" r="1.15" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M7 10V8a5 5 0 0 1 10 0v2" />
      <rect x="5" y="10" width="14" height="10" rx="2.2" />
      <circle cx="12" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function SparklesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M18.5 14l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
    </Svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function FolderPlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.4.6L11 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 11v4M10 13h4" />
    </Svg>
  );
}

export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function SlidersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" fill="white" />
      <circle cx="15" cy="12" r="2" fill="white" />
      <circle cx="7" cy="17" r="2" fill="white" />
    </Svg>
  );
}
