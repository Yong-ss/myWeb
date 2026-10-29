import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva("inline-flex w-fit shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 text-xs leading-normal font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "border-border bg-selected text-gold",
      success: "border-success/40 bg-success-bg text-success",
      warning: "border-warning/40 bg-warning-bg text-warning",
      destructive: "border-destructive/40 bg-error-bg text-destructive",
      info: "border-info/40 bg-info-bg text-info",
      outline: "border-border bg-transparent text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
})

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
