"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"

import { closeFocus, DialogOverlay, type OverlayContentProps } from "./dialog"
import { useMotionKind, useOpen, withOpenState } from "./motion"

// Side drawer (the phone navigation). Same Radix Dialog behaviour as Dialog; it slides in from the right edge.
const Sheet = withOpenState(SheetPrimitive.Root, "sheet")
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

function SheetContent({ className, children, onCloseFocus, ...props }: OverlayContentProps) {
  const open = useOpen()
  const animation = useMotionKind("drawer")
  return (
    <AnimatePresence>
      {open && (
        <SheetPrimitive.Portal forceMount>
          <DialogOverlay />
          <SheetPrimitive.Content asChild forceMount onCloseAutoFocus={closeFocus(onCloseFocus)} {...props}>
            <motion.div
              data-slot="sheet-content"
              className={cn(
                "fixed inset-y-0 right-0 z-(--club-z-dialog) flex h-dvh w-[min(20rem,calc(100vw-2rem))] flex-col overflow-y-auto overscroll-contain border-l border-brass bg-card pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-drawer outline-none data-[state=closed]:pointer-events-none",
                className
              )}
              {...animation}
            >
              {children}
            </motion.div>
          </SheetPrimitive.Content>
        </SheetPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex items-center justify-between gap-2 px-4 pb-6", className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("m-0 text-lg", className)} {...props} />
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("m-0 text-sm text-muted-foreground", className)} {...props} />
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger }
