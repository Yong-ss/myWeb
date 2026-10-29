"use client"

import * as React from "react"
import { createContext, useContext, useState } from "react"
import { useReducedMotion, type Transition } from "motion/react"

// Shared Motion timing, built on the --club-motion-* / --club-ease-* tokens. Opening is a little slower than
// closing: it reads as arrival, and dismissal never makes the user wait.
export const ease = { enter: [0.16, 1, 0.3, 1], feedback: [0.2, 0, 0.2, 1], drawer: [0.32, 0.72, 0, 1] } as const
export const enter: Transition = { duration: 0.18, ease: ease.enter }
export const exit: Transition = { duration: 0.12, ease: ease.feedback }
/** Backdrops fade a touch longer than the surface above them, so the dimming never "snaps". */
export const overlayIn: Transition = { duration: 0.24, ease: ease.feedback }
export const overlayOut: Transition = { duration: 0.18, ease: ease.feedback }
/** Centred surfaces (dialogs): settle in with a short rise. */
export const surfaceIn: Transition = { duration: 0.26, ease: ease.enter }
export const surfaceOut: Transition = { duration: 0.16, ease: ease.feedback }
/** Shared-element moves (e.g. the active tab marker): critically damped, so it glides without bouncing. */
export const glide: Transition = { type: "spring", stiffness: 520, damping: 44, mass: 0.9 }

/** With reduced motion every Motion transition is instant: state changes, nothing moves or fades. */
export function useMotion(transition: Transition): Transition {
  return useReducedMotion() ? { duration: 0 } : transition
}

/**
 * Overlay content stays mounted while it animates out (Radix `forceMount` inside Motion `AnimatePresence`), so it
 * reads the open state from its Root. Radix still owns focus trapping and return, Escape, outside clicks and scroll
 * lock; once `open` is false it stops trapping focus and blocking the page, and the exiting layer ignores pointers.
 */
const OpenContext = createContext(false)
export const useOpen = () => useContext(OpenContext)

type RootProps = { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }

/** Wraps a Radix Root so its animated content knows whether it is open (works controlled and uncontrolled). */
export function withOpenState<P extends RootProps>(Root: React.ComponentType<P>, slot: string) {
  function OpenStateRoot({ open, defaultOpen = false, onOpenChange, ...props }: P) {
    const [inner, setInner] = useState(defaultOpen)
    const current = open ?? inner
    const change = (next: boolean) => { if (open === undefined) setInner(next); onOpenChange?.(next) }
    return <OpenContext.Provider value={current}><Root data-slot={slot} {...(props as unknown as P)} open={current} onOpenChange={change} /></OpenContext.Provider>
  }
  return OpenStateRoot
}
