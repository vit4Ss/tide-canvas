"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { SHOWCASE_ROWS, type ShowcaseReference } from "@/lib/home-showcase";
import styles from "./home-showcase.module.css";

function ReferenceTile({ item }: { item: ShowcaseReference }) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <Link className={styles.tile} style={{ "--tile-width": `${item.width}px` } as CSSProperties}
      href={`/studio?type=image&prompt=${encodeURIComponent(item.prompt)}`} prefetch={false}
      aria-label={`Use the ${item.category.toLowerCase()} prompt: ${item.title}`}>
      {!unavailable && <img src={item.src} alt={item.alt} loading="lazy" decoding="async" onError={() => setUnavailable(true)} />}
      {unavailable && <span className={styles.unavailable}>Image unavailable. The prompt is still ready to use.</span>}
      <span className={styles.caption}>
        <span className={styles.category}>{item.category}</span>
        <span className={styles.tileTitle}>{item.title}</span>
        <span className={styles.action}>Use this prompt <ArrowUpRight size={15} aria-hidden /></span>
      </span>
    </Link>
  );
}

export default function HomeShowcase() {
  const rail = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () => setEdges({ start: element.scrollLeft <= 2, end: element.scrollWidth - element.clientWidth - element.scrollLeft <= 2 });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (track.current) observer.observe(track.current);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); };
  }, []);
  const browse = (direction: number) => {
    const element = rail.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * .65, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return (
    <section className={styles.showcase} aria-labelledby="showcase-title">
      <div className={`wrap ${styles.heading}`}>
        <h2 id="showcase-title">One space.<br /><span>Endless directions.</span></h2>
        <div className={styles.introduction}>
          <p>A product with presence. A place to get lost. A different way of seeing. Find a starting point, then make it yours.</p>
          <Link href="/studio" className="text-link">Create something of your own <ArrowUpRight size={16} /></Link>
        </div>
      </div>
      <div className={styles.rail} ref={rail} id="showcase-gallery" role="region" aria-label="Photographic inspiration gallery" tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); browse(event.key === "ArrowLeft" ? -1 : 1); }
          if (event.key === "Home" || event.key === "End") { event.preventDefault(); event.currentTarget.scrollTo({ left: event.key === "Home" ? 0 : event.currentTarget.scrollWidth, behavior: "instant" }); }
        }}>
        <div className={styles.track} ref={track}>
          {SHOWCASE_ROWS.map((row, index) => <div className={styles.row} key={index}>{row.map((item) => <ReferenceTile key={item.id} item={item} />)}</div>)}
        </div>
      </div>
      <div className={`wrap ${styles.footer}`}>
        <p>Curated photographic references, paired with editable prompts.<br />Your creations begin in the studio.</p>
        <div className={styles.controls}>
          <span>Explore the gallery</span>
          <button type="button" onClick={() => browse(-1)} disabled={edges.start} aria-label="Previous inspiration" aria-controls="showcase-gallery"><ArrowLeft size={18} /></button>
          <button type="button" onClick={() => browse(1)} disabled={edges.end} aria-label="Next inspiration" aria-controls="showcase-gallery"><ArrowRight size={18} /></button>
        </div>
      </div>
    </section>
  );
}
