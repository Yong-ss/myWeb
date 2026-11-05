"use client"

import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"

import { useMotionKind, useOpen, withOpenState } from "./motion"

/** Placement of anchored content (Popover, DropdownMenu, Tooltip), library-neutral. */
export type AnchoredProps = {
  className?: string
  children?: React.ReactNode
  id?: string
  "aria-label"?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  sideOffset?: number
}

// Anchored panel for help text or a short form next to its trigger. Escape and outside clicks close it.
const Popover = withOpenState(PopoverPrimitive.Root, "popover")
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverClose = PopoverPrimitive.Close

function PopoverContent({ className, align = "start", sideOffset = 8, children, ...props }: AnchoredProps) {
  const open = useOpen()
  const animation = useMotionKind("popover")
  return (
    <AnimatePresence>
      {open && (
        <PopoverPrimitive.Portal forceMount>
          <PopoverPrimitive.Content asChild forceMount align={align} sideOffset={sideOffset} collisionPadding={16} {...props}>
            <motion.div
              data-slot="popover-content"
              className={cn(
                "z-(--club-z-overlay) w-[min(22.5rem,calc(100vw-2rem))] origin-(--radix-popover-content-transform-origin) rounded-sm border border-brass bg-popover p-5 text-sm text-popover-foreground shadow-overlay outline-none data-[state=closed]:pointer-events-none",
                className
              )}
              {...animation}
            >
              {children}
            </motion.div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger }
