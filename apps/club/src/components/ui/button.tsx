"use client"

import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { CheckIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "cn"
import { LoadingSpinner } from "../feedback/LoadingSpinner"

// Brass-edged square controls; hover is mouse-only and disabled-aware (`hover` variant in globals.css).
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm border font-sans text-sm leading-normal font-medium whitespace-nowrap no-underline select-none transition-[background-color,border-color,color,box-shadow,scale] duration-150 ease-club-feedback active:scale-[0.98] active:duration-75 disabled:active:scale-100 aria-pressed:border-gold aria-pressed:bg-selected aria-pressed:text-gold aria-pressed:shadow-[inset_0_0_0_1px_var(--club-border-strong)] disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground aria-disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "border-brass bg-selected text-gold hover:border-gold hover:bg-hover active:bg-pressed active:text-ring",
        secondary: "border-border bg-transparent text-foreground hover:border-gold hover:bg-hover hover:text-gold active:bg-pressed active:text-ring",
        destructive: "border-destructive bg-error-bg text-destructive hover:bg-destructive/15 active:bg-destructive/25",
        ghost: "border-transparent bg-transparent text-gold hover:bg-hover active:bg-pressed",
      },
      size: {
        default: "min-h-11 min-w-24 px-4 py-2",
        compact: "min-h-11 px-3 py-2",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Disables the button and shows a spinner; the label keeps its width so the layout does not move. */
    loading?: boolean
    loadingText?: string
    /** Briefly confirm a finished action (see useSuccessFlash). Visual only; announce results elsewhere. */
    success?: boolean
    successText?: string
  }

function Button({ className, variant, size, asChild = false, loading = false, loadingText = "处理中…", success = false, successText = "已完成", disabled, children, type = "button", ...props }: ButtonProps) {
  if (asChild) return <Slot.Root data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</Slot.Root>
  return (
    <button
      data-slot="button"
      data-variant={variant ?? "primary"}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <>
        <span className="invisible" aria-hidden="true">{children}</span>
        <span className="absolute inset-0 flex animate-[club-fade-in_160ms_var(--club-ease-feedback)] items-center justify-center gap-2"><LoadingSpinner size="xs" />{loadingText}</span>
      </> : success ? <>
        <span className="opacity-0">{children}</span>
        <span aria-hidden="true" className="absolute inset-0 flex animate-[club-fade-in_160ms_var(--club-ease-feedback)] items-center justify-center gap-2 text-success"><CheckIcon weight="bold" className="animate-[club-pop-in_220ms_var(--club-ease-enter)]" />{successText}</span>
      </> : children}
    </button>
  )
}

/** Navigation that looks like a button. Use Button for actions, ButtonLink for moving to another page. */
function ButtonLink({ className, variant, size, ...props }: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

/** `[success, flash]`: call flash() after the request resolves; the button shows its success state for a moment. */
function useSuccessFlash(ms = 1600) {
  const [success, setSuccess] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const flash = () => { setSuccess(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setSuccess(false), ms) }
  return [success, flash] as const
}

export { Button, ButtonLink, buttonVariants, useSuccessFlash }
