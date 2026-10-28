import type { ReactNode } from "react";
import { Button } from "../ui/Button";
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
  if (props.status === "error") return <div className="club-feedback-state club-feedback-state--error" role="alert">
    <span className="club-feedback-state__symbol" aria-hidden="true">!</span>
    <h2>{props.title ?? "档案读取失败"}</h2>
    <p>{props.detail ?? "暂时无法读取资料，请检查连接后重试。"}</p>
    <Button onClick={props.onRetry}>重试</Button>
  </div>;
  return <div className="club-feedback-state" role="status">
    <span className="club-feedback-state__symbol" aria-hidden="true">{props.status==='ready'?'✓':'◇'}</span>
    <h2>{props.title ?? (props.status==='ready'?'记录已准备好':"这里还没有记录")}</h2>
    <p>{props.detail ?? (props.status==='ready'?'资料已准备就绪。':"完成首次导入后，档案会出现在这里。")}</p>
    {props.action && <div className="club-feedback-state__action">{props.action}</div>}
  </div>;
}
