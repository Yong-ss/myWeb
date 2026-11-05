import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// An inline message next to the content it is about (counts, warnings, request errors). For short confirmations
// that need no action use toast; for form-field errors use FieldError. Set role="alert"/"status" where it updates.
const noticeVariants = cva("m-0 rounded-sm border px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]", {
  variants: {
    variant: {
      neutral: "border-border bg-card",
      info: "border-info/40 bg-info-bg",
      success: "border-success/40 bg-success-bg text-success",
      warning: "border-warning/40 bg-warning-bg",
      destructive: "border-destructive bg-error-bg text-destructive",
    },
  },
  defaultVariants: { variant: "neutral" },
})

type NoticeProps = VariantProps<typeof noticeVariants> & { className?: string }

function Notice({ className, variant, as = "p", ...props }: NoticeProps & ({ as?: "p" } & React.ComponentProps<"p"> | { as: "div" } & React.ComponentProps<"div"> | { as: "ul" } & React.ComponentProps<"ul">)) {
  const Element = as as "p"
  return <Element data-slot="notice" data-variant={variant ?? "neutral"} className={cn(noticeVariants({ variant }), className)} {...(props as React.ComponentProps<"p">)} />
}

export { Notice }
