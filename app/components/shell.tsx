import Link from "next/link";
import { Nav } from "./nav";

/**
 * Page frame: wordmark + tagline (or a back link and page title), content,
 * and the bottom tab bar. Pages inside the frame get padding for the bar.
 */
export function Shell({
  children,
  title,
  eyebrow,
  back,
  aside,
  nav = true,
}: {
  children: React.ReactNode;
  /** Large display heading. When omitted, the wordmark is shown instead. */
  title?: string;
  /** Small caps line under the title. */
  eyebrow?: string;
  /** Back link { href, label }. */
  back?: { href: string; label: string };
  /** Right-aligned header content. */
  aside?: React.ReactNode;
  nav?: boolean;
}) {
  return (
    <>
      <main className={`mx-auto w-full max-w-xl flex-1 px-5 pt-6 ${nav ? "pb-28" : "pb-10"}`}>
        <header className="mb-6">
          {back ? (
            <Link href={back.href} className="text-sm text-muted">
              ← {back.label}
            </Link>
          ) : (
            <Wordmark />
          )}
          {title && (
            <div className="mt-3 flex items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-4xl leading-none">{title}</h1>
                {eyebrow && <p className="eyebrow mt-2">{eyebrow}</p>}
              </div>
              {aside}
            </div>
          )}
          {!title && aside && <div className="mt-3">{aside}</div>}
        </header>
        {children}
      </main>
      {nav && <Nav />}
    </>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="block">
      <span className="font-display text-5xl leading-none">Lode</span>
      <span className="eyebrow mt-1 block">Languages for a richer life</span>
    </Link>
  );
}
