import type { ReactNode } from "react";
export function PageHeader({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return <header className="club-page-header"><p className="eyebrow">{eyebrow}</p><div className="row-heading"><h1>{title}</h1>{actions}</div></header>;
}
