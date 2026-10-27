import type { ComponentProps } from "react";
export function Panel({ className = "", ...props }: ComponentProps<"section">) { return <section {...props} className={`panel club-panel ${className}`} />; }
