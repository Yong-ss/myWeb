"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CheckCircleIcon, InfoIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react"
import { LoadingSpinner } from "../feedback/LoadingSpinner"

// Brief confirmations that need no action (e.g. "copied"). Anything the user must read or act on stays inline
// next to its control (FieldError, LoadingState). Call `toast.success(...)` from "sonner"; ClubFrame renders this.
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
        toast: "flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-sm border border-brass bg-popover px-4 py-3 font-sans text-sm text-popover-foreground shadow-[0_16px_40px_rgb(0_0_0/.45)]",
        error: "border-destructive",
        description: "text-muted-foreground",
      },
    }}
    {...props}
  />
)

export { Toaster }
