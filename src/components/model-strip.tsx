"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useResource } from "@/lib/use-resource";
import { MODEL_PROVIDERS, modelProvider } from "@/lib/model-providers";
import type { StudioModel } from "@/lib/api";
import styles from "./model-strip.module.css";
export default function ModelStrip() {
  const catalog = useResource<StudioModel[]>("/api/market/studio-models");
  const available = new Set((catalog.data || []).map((model) => modelProvider(model)?.id));
  const providers = MODEL_PROVIDERS.filter((provider) => available.has(provider.id));
  return (
    <section className={`wrap ${styles.section}`} aria-label="Models in the creative collection">
      <div className={styles.header}>
        <p>Different models. <strong>The same creative space.</strong></p>
        <Link href="/models" className="text-link">Explore models <ArrowUpRight size={15} /></Link>
      </div>
      <ul className={styles.logos} aria-label="Available media model providers">
        {providers.length ? providers.map((provider) => <li key={provider.id}>
          <Link href={`/models?provider=${provider.id}`} prefetch={false}>
            <img src={`/model-icons/${provider.icon}.png`} alt="" width={24} height={24} className={provider.monochrome ? styles.monochrome : undefined} />
            <span>{provider.name}</span>
          </Link>
        </li>) : ["Image", "Video", "Audio", "3D", "Enhance"].map((name) => <li key={name} className={styles.fallback}>{name}</li>)}
      </ul>
    </section>
  );
}
