import type { ReactNode } from "react";
/** Page title block: small-caps overline, gold serif title, actions on the right, a brass rule fading out below. */
export function PageHeader({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return <header className="club-page-header mb-6">
    <p className="eyebrow">{eyebrow}</p>
    <div className="relative flex flex-wrap items-center justify-between gap-4 pb-6 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[linear-gradient(90deg,var(--club-border-strong),var(--club-border)_45%,transparent)] max-md:gap-2">
      <h1 className="gold-title my-2 text-title">{title}</h1>{actions}
    </div>
  </header>;
}
