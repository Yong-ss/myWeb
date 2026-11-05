"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import type { AnchoredProps } from "./popover"

// A short name for an icon-only control, shown on hover and keyboard focus. Never put the only copy of
// important information or an action inside a tooltip (touch users cannot reach it). ClubFrame provides the Provider.
function TooltipProvider({ delayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
}

type TooltipProps = { children?: React.ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; /** ms before it shows; defaults to the Provider's 300. */ delay?: number }
function Tooltip({ delay, ...props }: TooltipProps) {
  return <TooltipPrimitive.Root delayDuration={delay} {...props} />
}
const TooltipTrigger = TooltipPrimitive.Trigger

// Tooltips are tiny and frequent: CSS keyframes keyed on data-state. Radix waits for the exit animation to end.
function TooltipContent({ className, sideOffset = 6, children, ...props }: AnchoredProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn("z-(--club-z-toast) max-w-xs origin-(--radix-tooltip-content-transform-origin) animate-[club-tooltip-in_var(--club-motion-tooltip-in)_var(--club-ease-enter)] data-[state=closed]:animate-[club-tooltip-out_var(--club-motion-tooltip-out)_var(--club-ease-feedback)_forwards] rounded-sm border border-border bg-secondary px-3 py-1.5 text-xs text-foreground shadow-tooltip", className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
