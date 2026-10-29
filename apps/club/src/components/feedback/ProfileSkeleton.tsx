import { cn } from "cn";
import { Skeleton } from "../ui/skeleton";

type ProfileSkeletonProps = { className?: string; label?: string };

const box = "rounded-sm border border-border bg-card";

export function ProfileSkeleton({ className, label = "正在读取玩家档案…" }: ProfileSkeletonProps) {
  return <section className={cn("club-profile-skeleton m-0 grid gap-4", className)} role="status" aria-label={label} aria-busy="true">
    <div className={cn(box, "flex items-center gap-6 p-6")} aria-hidden="true">
      <div className="grid size-17.5 shrink-0 place-items-center border border-brass font-heading text-3xl text-brass">◇</div>
      <div className="grid w-full max-w-65 gap-3">
        <Skeleton className="h-4.5 w-[45%]" /><Skeleton className="w-[68%]" /><Skeleton className="w-[29%]" />
      </div>
    </div>
    <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1" aria-hidden="true">
      {Array.from({length:3},(_,i)=><div className={cn(box, "grid min-h-24 gap-4 p-4 max-sm:min-h-17")} key={i}>
        <Skeleton className="w-[58%]" /><Skeleton className="h-5 w-[40%]" />
      </div>)}
    </div>
    <div className={cn(box, "p-6")} aria-hidden="true">
      <Skeleton className="mb-3.5 w-1/4" />
      {[62,74,47,58].map(width=><div className="ml-1.25 flex items-center gap-3 border-l border-divider py-3" key={width}>
        <i className="-ml-1.25 size-2.25 shrink-0 rotate-45 bg-brass" /><Skeleton className="ml-2" style={{width:`${width}%`}} />
      </div>)}
    </div>
    <span className="sr-only">{label}</span>
  </section>;
}
