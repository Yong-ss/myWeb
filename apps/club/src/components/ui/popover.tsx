"use client"

import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"

import { enter, exit, useMotion, useOpen, withOpenState } from "./motion"

// Anchored panel for help text or a short form next to its trigger. Escape and outside clicks close it.
const Popover = withOpenState(PopoverPrimitive.Root, "popover")
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverClose = PopoverPrimitive.Close

function PopoverContent({ className, align = "start", sideOffset = 8, children, ...props }: Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "asChild" | "forceMount">) {
  const open = useOpen()
  const inTransition = useMotion(enter), outTransition = useMotion(exit)
  return (
    <AnimatePresence>
      {open && (
        <PopoverPrimitive.Portal forceMount>
          <PopoverPrimitive.Content asChild forceMount align={align} sideOffset={sideOffset} collisionPadding={16} {...props}>
            <motion.div
              data-slot="popover-content"
              className={cn(
                "z-30 w-[min(22.5rem,calc(100vw-2rem))] origin-(--radix-popover-content-transform-origin) rounded-sm border border-brass bg-popover p-5 text-sm text-popover-foreground shadow-[0_16px_40px_rgb(0_0_0/.45)] outline-none data-[state=closed]:pointer-events-none",
                className
              )}
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, transition: inTransition }} exit={{ opacity: 0, y: -4, transition: outTransition }}
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
