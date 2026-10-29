"use client"

import * as React from "react"
import { cn } from "cn"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid gap-3", className)} {...props} />
}

/** The selected mark is a small brass diamond, the one occult accent on form controls. */
function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "peer relative grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border border-brass bg-field transition-[border-color,background-color,scale] duration-150 active:scale-90 ease-club-feedback hover:border-gold disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled data-[state=checked]:border-gold",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rotate-45 bg-gold data-[state=checked]:animate-[club-pop-in_200ms_var(--club-ease-enter)]" />
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
