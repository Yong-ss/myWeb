"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "motion/react"
import { XIcon } from "@phosphor-icons/react"

import { Button } from "./button"
import { useMotionKind, useOpen, withOpenState } from "./motion"

const Dialog = withOpenState(DialogPrimitive.Root, "dialog")
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

/**
 * What pages may pass to Dialog, AlertDialog and Sheet content. Kept library-neutral on purpose: the Radix-only
 * props (forceMount, onCloseAutoFocus, onPointerDownOutside…) stay inside components/ui.
 */
export type OverlayContentProps = {
  className?: string
  children?: React.ReactNode
  id?: string
  "aria-describedby"?: string
  "aria-label"?: string
  /** Move focus yourself after closing (e.g. to a row that no longer has a trigger). Default: back to the trigger. */
  onCloseFocus?: () => void
}

/** Turns `onCloseFocus` into the Radix close-focus handler. */
export const closeFocus = (onCloseFocus?: () => void) => onCloseFocus ? (event: Event) => { event.preventDefault(); onCloseFocus() } : undefined

/** The centred dialog panel, shared by Dialog and AlertDialog. */
export const dialogSurface = "fixed top-1/2 left-1/2 z-(--club-z-dialog) flex max-h-[calc(100dvh-2rem)] -translate-1/2 flex-col gap-4 overflow-y-auto overscroll-contain rounded-sm border border-brass bg-popover p-6 text-popover-foreground shadow-dialog outline-none data-[state=closed]:pointer-events-none max-md:p-4"

/** Shared overlay: dims the page, ignores pointers while it fades out so a closing dialog never blocks a click. */
function DialogOverlay({ className }: { className?: string }) {
  const animation = useMotionKind("overlay")
  return (
    <DialogPrimitive.Overlay asChild forceMount>
      <motion.div data-slot="dialog-overlay" className={cn("fixed inset-0 z-(--club-z-dialog) bg-[var(--club-backdrop)] data-[state=closed]:pointer-events-none", className)} {...animation} />
    </DialogPrimitive.Overlay>
  )
}

type ContentProps = OverlayContentProps & {
  /** Adds the square × in the corner (labelled 关闭). Prefer an explicit footer action for flows. */
  showCloseButton?: boolean
  closeLabel?: string
}

/** Centred dialog that rises and settles in (motion kind `surface`). Radix keeps focus inside and restores it. */
function DialogContent({ className, children, showCloseButton = false, closeLabel = "关闭", onCloseFocus, ...props }: ContentProps) {
  const open = useOpen()
  const animation = useMotionKind("surface")
  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Portal forceMount>
          <DialogOverlay />
          <DialogPrimitive.Content asChild forceMount onCloseAutoFocus={closeFocus(onCloseFocus)} {...props}>
            <motion.div data-slot="dialog-content" className={cn(dialogSurface, "w-[min(32rem,calc(100vw-2rem))]", className)} {...animation}>
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

/** Action row of Dialog and AlertDialog. */
export const dialogFooter = "mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-divider pt-4"

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn(dialogFooter, className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("m-0 text-xl", className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("m-0 text-sm leading-relaxed text-muted-foreground", className)} {...props} />
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogTitle, DialogTrigger }
