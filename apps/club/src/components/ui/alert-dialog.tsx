"use client"

import * as React from "react"
import { cn } from "cn"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"

import { overlayIn, overlayOut, surfaceIn, surfaceOut, useMotion, useOpen, withOpenState } from "./motion"

// For confirmations that change or discard data. Unlike Dialog, an outside click never closes it and the role is
// `alertdialog`. Confirm with a normal Button (it can stay open while the request runs); cancel with AlertDialogCancel.
const AlertDialog = withOpenState(AlertDialogPrimitive.Root, "alert-dialog")
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogCancel = AlertDialogPrimitive.Cancel

function AlertDialogContent({ className, children, ...props }: Omit<React.ComponentProps<typeof AlertDialogPrimitive.Content>, "asChild" | "forceMount">) {
  const open = useOpen()
  const inTransition = useMotion(surfaceIn), outTransition = useMotion(surfaceOut)
  const fadeIn = useMotion(overlayIn), fadeOut = useMotion(overlayOut)
  return (
    <AnimatePresence>
      {open && (
        <AlertDialogPrimitive.Portal forceMount>
          <AlertDialogPrimitive.Overlay asChild forceMount>
            <motion.div
              data-slot="alert-dialog-overlay"
              className="fixed inset-0 z-40 bg-[var(--club-backdrop)] data-[state=closed]:pointer-events-none"
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fadeIn }} exit={{ opacity: 0, transition: fadeOut }}
            />
          </AlertDialogPrimitive.Overlay>
          <AlertDialogPrimitive.Content asChild forceMount {...props}>
            <motion.div
              data-slot="alert-dialog-content"
              className={cn(
                "fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100dvh-2rem)] w-[min(35rem,calc(100vw-2rem))] -translate-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-sm border border-brass bg-popover p-6 text-popover-foreground shadow-[0_24px_64px_rgb(0_0_0/.5)] outline-none data-[state=closed]:pointer-events-none max-md:p-4",
                className
              )}
              initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: inTransition }} exit={{ opacity: 0, y: 4, scale: 0.99, transition: outTransition }}
            >
              {children}
            </motion.div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("m-0 text-xl", className)} {...props} />
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn("m-0 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-divider pt-4", className)} {...props} />
}

export { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger }
