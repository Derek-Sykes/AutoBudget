"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/funding-plan", label: "Funding plan" },
  { href: "/activity", label: "Activity" },
  { href: "/account", label: "Account" },
  { href: "/about", label: "About" },
];

export function NavLinks({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center justify-end gap-1 text-sm">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        const showBadge = l.href === "/activity" && unreadCount > 0;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative whitespace-nowrap rounded-lg px-2.5 py-1.5 font-medium transition sm:px-3 ${
              active
                ? "bg-brand-50 text-brand-700"
                : "text-muted hover:bg-slate-100 hover:text-ink"
            }`}
          >
            {l.label}
            {showBadge && (
              <span
                className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white"
                aria-label={`${unreadCount} unread`}
              >
                {unreadCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
