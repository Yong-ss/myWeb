import * as React from "react"
import { cn } from "cn"

/** Scrolls sideways inside its own border on narrow screens; the page itself never scrolls horizontally. */
function Table({ className, containerClassName, ...props }: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div data-slot="table-container" className={cn("relative w-full overflow-x-auto overscroll-x-contain rounded-sm border border-border bg-card", containerClassName)}>
      <table data-slot="table" className={cn("w-full border-collapse text-sm tabular-nums", className)} {...props} />
    </div>
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("px-4 py-3 text-left text-sm text-muted-foreground", className)} {...props} />
}

function TableHeader(props: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("group/row", className)} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th data-slot="table-head" scope="col" className={cn("border-b border-divider bg-secondary px-4 py-3 text-left align-middle text-xs font-medium tracking-wider whitespace-nowrap text-gold", className)} {...props} />
}

// Row hover paints the cells, so sticky cells (which carry their own background) highlight with the row.
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("border-b border-divider px-4 py-3 text-left whitespace-nowrap transition-colors duration-120 ease-club-feedback group-hover/row:bg-hover", className)} {...props} />
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow }
