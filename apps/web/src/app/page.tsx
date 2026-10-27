import Link from "next/link";
export default function Home() {
    return (<>
      <a className="skip-link" href="#main">跳到主要内容</a>
      <header className="site-header shell">
        <Link className="brand" href="/" aria-label="SquirrelAPI 首页"><span className="brand-mark" aria-hidden="true">S</span>SquirrelAPI</Link>
        <nav aria-label="主导航"><a href="#apps">应用</a><a href="#about">关于</a><Link href="/account">账户</Link></nav>
      </header>
      <main id="main" className="shell">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow"><span aria-hidden="true"/> 一个正在生长的工具空间</p>
          <h1 id="hero-title">小工具，<br /><span>大可能。</span></h1>
          <p className="intro">收集灵感，解决日常的小问题。<br />让有用的想法，在这里慢慢长成应用。</p>
          <a className="button" href="#apps">看看这里有什么 <span aria-hidden="true">↗</span></a>
          <div className="hero-note" aria-hidden="true"><span>从一颗种子开始。</span><div className="seed">✳</div><span>SQUIRRELAPI / 001</span></div>
        </section>
        <section id="apps" className="apps-section" aria-labelledby="apps-title">
          <div className="section-heading"><div><p className="eyebrow">THE COLLECTION</p><h2 id="apps-title">应用空间</h2></div><span className="count">0 个已上线</span></div>
          <div className="empty-state"><span className="empty-icon" aria-hidden="true">＋</span><div><h3>第一个小工具，还在酝酿中</h3><p>这里将收录可以直接使用的应用。等准备好了，我们在这里见。</p></div><span className="badge">敬请期待</span></div>
        </section>
        <section id="about" className="about" aria-labelledby="about-title"><p className="eyebrow">A LITTLE ABOUT US</p><h2 id="about-title">为实用而做，留一点好奇。</h2><p>SquirrelAPI 是一个持续探索的小项目。我们从简单的需求出发，一次做好一件事，让每一个工具都有自己的用处。</p></section>
      </main>
      <footer className="shell"><Link className="brand" href="/">SquirrelAPI</Link><span>小步前进，慢慢生长。</span></footer>
    </>);
}
