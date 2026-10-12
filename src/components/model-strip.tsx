"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useResource } from "@/lib/use-resource";
import { modelName } from "@/lib/brand";
import type { StudioModel } from "@/lib/api";
export default function ModelStrip() {
  const catalog = useResource<StudioModel[]>("/api/market/studio-models");
  const names = [...new Set((catalog.data || []).map((model) => modelName(model)))].slice(0, 5);
  return <section className="model-strip wrap"><span>Choose the model.<br /><strong>Keep the vision.</strong></span><div>{(names.length ? names : ["Image", "Video", "Audio", "3D", "Enhance"]).map((name) => <span key={name}>{name}</span>)}</div><Link href="/models" aria-label="Explore the live model collection"><ArrowUpRight size={20} /></Link></section>;
}
