"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="wrap error-page"><h1>Let&apos;s try that again.</h1><p>Something interrupted this page. Your accepted tasks may still be processing.</p><div className="hero-actions"><button className="button primary" onClick={reset}>Reload this view</button><Link className="button" href="/history">Check your activity</Link></div></section>; }
