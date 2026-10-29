import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from "../ui/empty";
import { PageLoader } from "./PageLoader";
import { TableSkeleton } from "./TableSkeleton";
import { ProfileSkeleton } from "./ProfileSkeleton";

type Props =
  | { status: "loading"; variant?: "page" | "table" | "profile"; label?: string; children?: never }
  | { status: "error"; title?: string; detail?: string; onRetry: () => void; children?: never }
  | { status: "empty"; title?: string; detail?: string; action?: ReactNode; children?: never }
  | { status: "ready"; children?: ReactNode; title?:string; detail?:string; action?:ReactNode };

/** Pure presentation. Keep auth checks, data fetching, stale-cache policies and error handling in the caller. */
export function LoadingState(props: Props) {
  if (props.status === "ready" && props.children !== undefined) return <>{props.children}</>;
  if (props.status === "loading") {
    if (props.variant === "table") return <TableSkeleton label={props.label} />;
    if (props.variant === "profile") return <ProfileSkeleton label={props.label} />;
    return <PageLoader title={props.label} />;
  }
  if (props.status === "error") return <Empty className="border-destructive" role="alert">
    <EmptyMedia className="border-destructive text-destructive">!</EmptyMedia>
    <EmptyTitle className="text-destructive">{props.title ?? "档案读取失败"}</EmptyTitle>
    <EmptyDescription>{props.detail ?? "暂时无法读取资料，请检查连接后重试。"}</EmptyDescription>
    <EmptyContent><Button onClick={props.onRetry}>重试</Button></EmptyContent>
  </Empty>;
  return <Empty role="status">
    <EmptyMedia>{props.status==='ready'?'✓':'◇'}</EmptyMedia>
    <EmptyTitle>{props.title ?? (props.status==='ready'?'记录已准备好':"这里还没有记录")}</EmptyTitle>
    <EmptyDescription>{props.detail ?? (props.status==='ready'?'资料已准备就绪。':"完成首次导入后，档案会出现在这里。")}</EmptyDescription>
    {props.action && <EmptyContent>{props.action}</EmptyContent>}
  </Empty>;
}
