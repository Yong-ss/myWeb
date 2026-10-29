import type { CSSProperties } from "react";
import { cn } from "cn";
import { Skeleton } from "../ui/skeleton";

type TableSkeletonProps = { rows?: number; columns?: number; className?: string; label?: string; announce?:boolean };

const widths = ["70%", "44%", "62%", "79%", "54%", "66%"];
const row = "grid grid-cols-[repeat(var(--loading-cols),minmax(84px,1fr))] items-center gap-3 p-4 max-sm:grid-cols-[repeat(var(--loading-cols),minmax(74px,1fr))] max-sm:gap-2 max-sm:p-3";

export function TableSkeleton({ rows = 6, columns = 6, className, label = "正在读取成员名单…",announce=true }: TableSkeletonProps) {
  const nRows = Math.max(1, Math.min(rows, 12));
  const nCols = Math.max(1, Math.min(columns, 12));
  const gridStyle = { "--loading-cols": nCols } as CSSProperties;
  return <div className={cn("club-table-skeleton w-full overflow-hidden rounded-sm border border-border bg-card", className)} role={announce?"status":undefined} aria-label={announce?label:undefined} aria-hidden={announce?undefined:true} aria-busy={announce?true:undefined}>
    <div className={cn(row, "bg-secondary py-3")} style={gridStyle} aria-hidden="true">
      {Array.from({length:nCols}, (_,i) => <Skeleton className="h-2 w-1/2 bg-[color-mix(in_srgb,var(--club-gold)_28%,var(--club-surface-elevated))]" key={i} />)}
    </div>
    {Array.from({length:nRows}, (_,r) => <div className={cn(row, "min-h-13.5 border-t border-divider")} style={gridStyle} aria-hidden="true" key={r}>
      {Array.from({length:nCols}, (_,c) => <Skeleton style={{width:widths[(r+c)%6]}} key={c} />)}
    </div>)}
    <span className="sr-only">{label}</span>
  </div>;
}
