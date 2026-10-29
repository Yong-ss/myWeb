import { cn } from "cn";

type LoadingSpinnerProps = {
  size?: "xs" | "sm" | "md" | "lg";
  /** Supply a label only when spinner is the entire feedback; button labels should describe their own busy state. */
  label?: string;
  className?: string;
};

const sizes = { xs: "size-[13px]", sm: "size-[18px]", md: "size-[30px]", lg: "size-22" };

export function LoadingSpinner({ size = "sm", label, className }: LoadingSpinnerProps) {
  return <span
    className={cn("club-loading-spinner inline-grid shrink-0 place-items-center align-middle text-gold", sizes[size], className)}
    role={label ? "status" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    <span className="club-loading-spinner__ring size-full animate-spin rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--club-gold)_22%,transparent)] border-t-current border-r-brass [animation-duration:1.05s]" />
  </span>;
}
