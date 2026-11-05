import * as React from "react"
import { cn } from "cn"

/** Shared look of every text field: inset well, brass edge, gold focus; 16px text on phones so iOS never zooms. */
export const fieldClass =
  "w-full min-w-0 min-h-11 rounded-sm border border-brass bg-field px-3 py-2 font-sans text-base leading-normal text-foreground transition-[border-color,background-color] ease-club-feedback placeholder:text-muted-foreground placeholder:opacity-100 hover:border-gold focus:border-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground aria-invalid:border-destructive md:text-sm"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        "file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-sm file:border file:border-brass file:bg-selected file:px-3 file:font-sans file:text-sm file:text-gold",
        type === "file" && "border-dashed py-3",
        className
      )}
      {...props}
    />
  )
}

export { Input }
