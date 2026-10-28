type LoadingSpinnerProps = {
  size?: "xs" | "sm" | "md";
  /** Supply a label only when spinner is the entire feedback; button labels should describe their own busy state. */
  label?: string;
  className?: string;
};

export function LoadingSpinner({ size = "sm", label, className = "" }: LoadingSpinnerProps) {
  return <span
    className={`club-loading-spinner club-loading-spinner--${size} ${className}`.trim()}
    role={label ? "status" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    <span className="club-loading-spinner__ring" />
  </span>;
}
