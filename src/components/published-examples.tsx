"use client";
import Link from "next/link";
import { useResource } from "@/lib/use-resource";
import { mediaUrl } from "@/lib/media";
import { modelName } from "@/lib/brand";
import type { StudioModel } from "@/lib/api";
import type { PageData } from "@/types/api";
import { Alert, EmptyState, Loading } from "./ui";

interface PublishedPost { id: string; type: string; cover: string; thumbnail: string; title: string; model: string; author?: { name: string } }
export function PublishedExamples({ model }: { model: StudioModel }) {
  const examples = useResource<PageData<PublishedPost>>(`/api/community/posts?pageSize=12&cat=framelyn-examples&keyword=${encodeURIComponent(model.modelKey || modelName(model))}`);
  const rows = (examples.data?.records || []).filter(item => ["image", "video"].includes(item.type) && typeof item.model === "string" && mediaUrl(item.thumbnail || item.cover) && [model.modelKey.toLowerCase(), modelName(model).toLowerCase()].includes(item.model.toLowerCase()));
  return <section className="published-examples"><h3>Published examples · {modelName(model)}</h3><p className="small muted">Work published in the Framelyn examples collection. Model labels are supplied by the publisher; these are not controlled quality or speed benchmarks.</p>
    {examples.loading && <Loading label="Looking for published examples…" />}
    {examples.error && <Alert>{examples.error}<button onClick={examples.refresh}>Try again</button></Alert>}
    {!examples.loading && !examples.error && !rows.length && <EmptyState title="No published examples for this model yet." description="Use a small first request to evaluate a model for your work. Photographic references elsewhere on the site are not generated results." />}
    <div className="example-grid">{rows.map(item => <article key={item.id}><a href={mediaUrl(item.cover)} target="_blank" rel="noreferrer"><img src={mediaUrl(item.thumbnail || item.cover)} alt={item.title && !/[\p{Script=Han}]/u.test(item.title) ? item.title : "Published community example"} loading="lazy" /></a><p>{item.model}</p>{item.author?.name && <small>By {item.author.name}</small>}</article>)}</div>
    <Link className="button small" href={`/studio?type=${model.type}&model=${encodeURIComponent(model.modelKey)}`}>Try this model</Link>
  </section>;
}
