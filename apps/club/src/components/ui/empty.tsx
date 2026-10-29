import * as React from "react"
import { cn } from "cn"

/** Empty and error states: a centred note with a brass seal, a heading, one sentence and at most two actions. */
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty" className={cn("mx-auto flex w-full max-w-xl animate-[club-rise-in_260ms_var(--club-ease-enter)] flex-col items-center gap-4 rounded-sm border border-border bg-card px-6 py-8 text-center text-balance", className)} {...props} />
}

function EmptyMedia({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="empty-media" aria-hidden="true" className={cn("grid size-11 place-items-center rounded-sm border border-brass font-heading text-2xl text-gold", className)} {...props} />
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="empty-title" className={cn("m-0 text-lg", className)} {...props} />
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("m-0 max-w-md text-sm leading-relaxed text-muted-foreground", className)} {...props} />
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-content" className={cn("flex flex-wrap items-center justify-center gap-4", className)} {...props} />
}

export { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle }
