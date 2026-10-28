type ProfileSkeletonProps = { className?: string; label?: string };

export function ProfileSkeleton({ className = "", label = "正在读取玩家档案…" }: ProfileSkeletonProps) {
  return <section className={`club-profile-skeleton ${className}`.trim()} role="status" aria-label={label} aria-busy="true">
    <div className="club-profile-skeleton__intro" aria-hidden="true">
      <div className="club-profile-skeleton__seal" />
      <div className="club-profile-skeleton__identity">
        <span className="club-skeleton-line" style={{width:"45%",height:18}} />
        <span className="club-skeleton-line" style={{width:"68%"}} />
        <span className="club-skeleton-line" style={{width:"29%"}} />
      </div>
    </div>
    <div className="club-profile-skeleton__tiles" aria-hidden="true">
      {Array.from({length:3},(_,i)=><div className="club-profile-skeleton__tile" key={i}>
        <span className="club-skeleton-line" style={{width:"58%"}} /><span className="club-skeleton-line" style={{width:"40%",height:20}} />
      </div>)}
    </div>
    <div className="club-profile-skeleton__timeline" aria-hidden="true">
      <span className="club-skeleton-line" style={{width:"25%",marginBottom:14}} />
      {Array.from({length:4},(_,i)=><div className="club-profile-skeleton__event" key={i}>
        <i/><span className="club-skeleton-line" style={{width:`${[62,74,47,58][i]}%`}} />
      </div>)}
    </div>
    <span className="club-visually-hidden">{label}</span>
  </section>;
}
