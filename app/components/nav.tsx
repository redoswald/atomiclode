"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/read", label: "Read", icon: BookIcon },
  { href: "/review", label: "Review", icon: RefreshIcon },
  { href: "/stats", label: "Stats", icon: ChartIcon },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur" aria-label="Main">
      <ul className="mx-auto flex max-w-xl justify-around px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex w-16 flex-col items-center gap-1 text-[11px] ${active ? "text-ink" : "text-muted"}`}
              >
                <Icon />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const svg = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function HomeIcon() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M12 6.5c-1.6-1.4-4-2-8-2v13c4 0 6.4.6 8 2 1.6-1.4 4-2 8-2v-13c-4 0-6.4.6-8 2Z" />
      <path d="M12 6.5v13" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M20 12a8 8 0 0 1-14.3 4.9" />
      <path d="M4 12a8 8 0 0 1 14.3-4.9" />
      <path d="M18.5 3v4.5H14" />
      <path d="M5.5 21v-4.5H10" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg {...svg} aria-hidden>
      <path d="M5 20V12" />
      <path d="M12 20V6" />
      <path d="M19 20v-4" />
    </svg>
  );
}
