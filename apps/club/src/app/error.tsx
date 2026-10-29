"use client";
import {useEffect} from "react";
import {LoadingState} from "../components/feedback";
// A crash inside one page shows this fallback; the shared shell and navigation (root layout) keep working.
export default function PageError({error,retry}:{error:unknown;retry:()=>void}){
 useEffect(()=>{console.error(error);},[error]);
 return <main className="club-workspace"><LoadingState status="error" title="这个页面出错了" detail="其他页面不受影响，可以重试或从侧栏前往其他页面。" onRetry={retry}/></main>;
}
