"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip as TooltipPrimitive } from "radix-ui"

// A short name for an icon-only control, shown on hover and keyboard focus. Never put the only copy of
// important information or an action inside a tooltip (touch users cannot reach it). ClubFrame provides the Provider.
function TooltipProvider({ delayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
}

const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

// Tooltips are tiny and frequent: CSS keyframes keyed on data-state. Radix waits for the exit animation to end.
function TooltipContent({ className, sideOffset = 6, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn("z-50 max-w-xs origin-(--radix-tooltip-content-transform-origin) animate-[club-tooltip-in_160ms_var(--club-ease-enter)] data-[state=closed]:animate-[club-tooltip-out_100ms_var(--club-ease-feedback)_forwards] rounded-sm border border-border bg-secondary px-3 py-1.5 text-xs text-foreground shadow-[0_8px_24px_rgb(0_0_0/.35)]", className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
