import Link from "next/link";
import type { ComponentProps } from "react";
import { LoadingSpinner } from "../feedback/LoadingSpinner";

type Variant = "primary" | "secondary" | "danger";
const classes = (variant: Variant, extra = "") => `club-button club-button--${variant} ${extra}`;
export function Button({ variant = "primary", loading = false, loadingText = "处理中…", disabled, children, className, type = "button", ...props }: ComponentProps<"button"> & { variant?: Variant; loading?: boolean; loadingText?: string }) {
  return <button {...props} type={type} className={classes(variant, className)} disabled={disabled || loading} aria-busy={loading || undefined}>{loading ? <><span style={{ visibility: "hidden" }} aria-hidden="true">{children}</span><span className="club-button-loading"><LoadingSpinner size="xs" />{loadingText}</span></> : children}</button>;
}
export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={classes(variant, className)} />;
}
