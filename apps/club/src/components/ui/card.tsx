import * as React from "react"
import { cn } from "cn"

/**
 * The Club panel. `ornate` adds the reference brass corner diamonds and lantern gradient; keep it for one or two
 * focal panels per page (sign-in, headline numbers), not every box.
 */
function Card({ className, ornate = false, ...props }: React.ComponentProps<"section"> & { ornate?: boolean }) {
  return (
    <section
      data-slot="card"
      className={cn("relative m-0 flex min-w-0 flex-col items-start gap-4 rounded-sm border border-border bg-card p-6 text-card-foreground max-md:p-4", ornate && "ornate", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("m-0 text-lg", className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("m-0 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
}

export { Card, CardDescription, CardTitle }
