"use client"

import { Toaster as Sonner, toast as sonnerToast, type ToasterProps } from "sonner"
import { CheckCircleIcon, InfoIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react"
import { LoadingSpinner } from "../feedback/LoadingSpinner"

// Brief confirmations that need no action (e.g. "copied"). Anything the user must read or act on stays inline
// next to its control (FieldError, LoadingState). Call `toast.success(...)` from here; ClubFrame renders the Toaster.
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    position="bottom-right"
    offset={16}
    mobileOffset={16}
    icons={{
      success: <CheckCircleIcon className="size-4 text-success" />,
      info: <InfoIcon className="size-4 text-info" />,
      warning: <WarningIcon className="size-4 text-warning" />,
      error: <XCircleIcon className="size-4 text-destructive" />,
      loading: <LoadingSpinner size="xs" />,
    }}
    toastOptions={{
      unstyled: true,
      classNames: {
        toast: "flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-sm border border-brass bg-popover px-4 py-3 font-sans text-sm text-popover-foreground shadow-overlay",
        error: "border-destructive",
        description: "text-muted-foreground",
      },
    }}
    {...props}
  />
)

type ToastOptions = { description?: string }
/** The only toast API pages use; the toast library stays behind it. */
const toast = Object.assign((message: string, options?: ToastOptions) => { sonnerToast(message, options) }, {
  success: (message: string, options?: ToastOptions) => { sonnerToast.success(message, options) },
  error: (message: string, options?: ToastOptions) => { sonnerToast.error(message, options) },
})

export { Toaster, toast }
