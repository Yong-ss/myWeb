import * as React from "react"
import { cn } from "cn"

/** A placeholder bar that pulses slowly (stops under reduced motion). Announce loading on the container, not here. */
function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="skeleton" aria-hidden="true" className={cn("block h-3 max-w-full animate-pulse rounded-sm bg-[color-mix(in_srgb,var(--club-text-secondary)_19%,var(--club-surface))]", className)} {...props} />
}

export { Skeleton }
