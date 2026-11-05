"use client"

import * as React from "react"
import { cn } from "cn"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"

import { closeFocus, dialogFooter, dialogSurface, type OverlayContentProps } from "./dialog"
import { useMotionKind, useOpen, withOpenState } from "./motion"

// For confirmations that change or discard data. Unlike Dialog, an outside click never closes it and the role is
// `alertdialog`. Confirm with a normal Button (it can stay open while the request runs); cancel with AlertDialogCancel.
const AlertDialog = withOpenState(AlertDialogPrimitive.Root, "alert-dialog")
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogCancel = AlertDialogPrimitive.Cancel

function AlertDialogContent({ className, children, onCloseFocus, ...props }: OverlayContentProps) {
  const open = useOpen()
  const surface = useMotionKind("surface"), overlay = useMotionKind("overlay")
  return (
    <AnimatePresence>
      {open && (
        <AlertDialogPrimitive.Portal forceMount>
          <AlertDialogPrimitive.Overlay asChild forceMount>
            <motion.div data-slot="alert-dialog-overlay" className="fixed inset-0 z-(--club-z-dialog) bg-[var(--club-backdrop)] data-[state=closed]:pointer-events-none" {...overlay} />
          </AlertDialogPrimitive.Overlay>
          <AlertDialogPrimitive.Content asChild forceMount onCloseAutoFocus={closeFocus(onCloseFocus)} {...props}>
            <motion.div data-slot="alert-dialog-content" className={cn(dialogSurface, "w-[min(35rem,calc(100vw-2rem))]", className)} {...surface}>
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
  return <div data-slot="alert-dialog-footer" className={cn(dialogFooter, className)} {...props} />
}

export { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger }
