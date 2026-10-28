import type { CSSProperties } from "react";

type TableSkeletonProps = { rows?: number; columns?: number; className?: string; label?: string; announce?:boolean };

export function TableSkeleton({ rows = 6, columns = 6, className = "", label = "正在读取成员名单…",announce=true }: TableSkeletonProps) {
  const nRows = Math.max(1, Math.min(rows, 12));
  const nCols = Math.max(1, Math.min(columns, 12));
  const gridStyle = { "--loading-cols": nCols } as CSSProperties;
  return <div className={`club-table-skeleton ${className}`.trim()} role={announce?"status":undefined} aria-label={announce?label:undefined} aria-hidden={announce?undefined:true} aria-busy={announce?true:undefined}>
    <div className="club-table-skeleton__header" style={gridStyle} aria-hidden="true">
      {Array.from({length:nCols}, (_,i) => <span className="club-skeleton-line club-skeleton-line--header" key={i} />)}
    </div>
    {Array.from({length:nRows}, (_,r) => <div className="club-table-skeleton__row" style={gridStyle} aria-hidden="true" key={r}>
      {Array.from({length:nCols}, (_,c) => <span className="club-skeleton-line" style={{width:`${[70,44,62,79,54,66][(r+c)%6]}%`}} key={c} />)}
    </div>)}
    <span className="club-visually-hidden">{label}</span>
  </div>;
}
