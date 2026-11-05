"use client"

import * as React from "react"
import { cn } from "cn"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "@phosphor-icons/react"

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm border border-brass bg-field text-gold transition-[border-color,background-color,scale] active:scale-90 ease-club-feedback hover:border-gold disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground data-[state=checked]:border-gold data-[state=checked]:bg-selected",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center data-[state=checked]:animate-[club-pop-in_180ms_var(--club-ease-enter)]">
        <CheckIcon weight="bold" className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
