"use client";
import {useEffect} from "react";
import {LoadingState} from "../components/feedback";
import {clearClubData} from "../lib/data-access";
// A crash inside one page shows this fallback; the shared shell and navigation (root layout) keep working.
// Next.js 16 passes `retry` (re-fetch and re-render the segment). The error text is never shown to the user.
export default function PageError({error,retry}:{error:unknown;retry:()=>void}){
 useEffect(()=>{console.error(error);},[error]);
 // Drop cached reads first, so retrying fetches fresh data instead of re-rendering the response that crashed.
 return <main className="club-workspace"><LoadingState status="error" title="这个页面出错了" detail="其他页面不受影响，可以重试或从侧栏前往其他页面。" onRetry={()=>{clearClubData();retry();}}/></main>;
}
