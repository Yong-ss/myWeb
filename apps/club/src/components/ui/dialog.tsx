"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"
import { XIcon } from "@phosphor-icons/react"

import { Button } from "./button"
import { overlayIn, overlayOut, surfaceIn, surfaceOut, useMotion, useOpen, withOpenState } from "./motion"

const Dialog = withOpenState(DialogPrimitive.Root, "dialog")
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

/** Shared overlay: dims the page, ignores pointers while it fades out so a closing dialog never blocks a click. */
function DialogOverlay({ className }: { className?: string }) {
  const fadeIn = useMotion(overlayIn), fadeOut = useMotion(overlayOut)
  return (
    <DialogPrimitive.Overlay asChild forceMount>
      <motion.div
        data-slot="dialog-overlay"
        className={cn("fixed inset-0 z-40 bg-[var(--club-backdrop)] data-[state=closed]:pointer-events-none", className)}
        initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fadeIn }} exit={{ opacity: 0, transition: fadeOut }}
      />
    </DialogPrimitive.Overlay>
  )
}

type ContentProps = Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "asChild" | "forceMount"> & {
  /** Adds the square × in the corner (labelled 关闭). Prefer an explicit footer action for flows. */
  showCloseButton?: boolean
  closeLabel?: string
}

/** Centred dialog that rises and settles in (opacity, 10px, 98% scale), then sinks away faster on close. Radix keeps focus inside and restores it. */
function DialogContent({ className, children, showCloseButton = false, closeLabel = "关闭", ...props }: ContentProps) {
  const open = useOpen()
  const inTransition = useMotion(surfaceIn), outTransition = useMotion(surfaceOut)
  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Portal forceMount>
          <DialogOverlay />
          <DialogPrimitive.Content asChild forceMount {...props}>
            <motion.div
              data-slot="dialog-content"
              className={cn(
                "fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] -translate-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-sm border border-brass bg-popover p-6 text-popover-foreground shadow-[0_24px_64px_rgb(0_0_0/.5)] outline-none data-[state=closed]:pointer-events-none max-md:p-4",
                className
              )}
              initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: inTransition }} exit={{ opacity: 0, y: 4, scale: 0.99, transition: outTransition }}
            >
              {children}
              {showCloseButton && (
                <DialogPrimitive.Close asChild>
                  <Button variant="ghost" size="icon" className="absolute top-2 right-2" aria-label={closeLabel}><XIcon /></Button>
                </DialogPrimitive.Close>
              )}
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-divider pt-4", className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("m-0 text-xl", className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("m-0 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogTitle, DialogTrigger }
