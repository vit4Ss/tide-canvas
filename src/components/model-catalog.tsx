"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUpRight, AudioLines, Box, CircleAlert, Image as ImageIcon, Layers2, ScanLine, Search, SlidersHorizontal, Video, X } from "lucide-react";
import { MODEL_PROVIDERS, modelProvider } from "@/lib/model-providers";
import { modelName, number } from "@/lib/brand";
import { useResource } from "@/lib/use-resource";
import { publicMediaModels } from "@/lib/public-models";
import { catalogCreditValue } from "@/lib/catalog-presentation";
import type { StudioModel } from "@/lib/api";
import { modelGuidance } from "@/lib/model-guidance";
import { usePreviewState } from "./use-preview-state";
import { PublishedExamples } from "./published-examples";
import { PublicPage } from "./shell";
import { Alert, EmptyState, Loading, Modal } from "./ui";
import { ModelIcon } from "./model-icon";
import styles from "./model-catalog.module.css";

const categories = [
  { value: "all", label: "All models", icon: Layers2 },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "video", label: "Video", icon: Video },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "3d", label: "3D", icon: Box },
  { value: "upscale", label: "Enhance", icon: ScanLine },
];
/** Format illustrations, not output samples, wave measurements or model scores. */
function FormatIllustration({ type }: { type: string }) {
  return <svg className={styles.illustration} viewBox="0 0 164 76" fill="none" aria-hidden="true">
    {type === "audio" ? <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {[12, 24, 40, 20, 52, 64, 36, 18, 44, 58, 30, 48, 20, 10].map((height, i) => <path key={i} d={`M${10 + i * 11} ${38 - height / 2}v${height}`} />)}
    </g> : type === "video" ? <g stroke="currentColor" strokeWidth="1.5">
      <rect x="6" y="10" width="62" height="48" rx="6" /><rect x="28" y="16" width="86" height="52" rx="6" />
      <rect x="61" y="7" width="93" height="55" rx="6" /><path d="m101 24 18 11-18 11Z" fill="currentColor" stroke="none" />
    </g> : type === "3d" ? <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="m81 3 43 22v31L81 75 39 54V24Z M39 24l42 21 43-20 M81 45v30 M81 3v31L39 54 M81 34l43 22" />
      <path d="m52 30 29-16 29 16M52 47l29 16 29-16" opacity=".45" />
    </g> : type === "upscale" ? <g stroke="currentColor" strokeWidth="1.5">
      <rect x="55" y="25" width="48" height="32" rx="3" /><path d="M20 25V9h24m77 0h23v16M20 49v17h24m77 0h23V49M56 25 37 12m65 13 27-13M56 56 37 66m65-10 27 10" />
    </g> : <g stroke="currentColor" strokeWidth="1.5">
      <rect x="20" y="12" width="80" height="54" rx="6" transform="rotate(-8 20 12)" />
      <rect x="61" y="8" width="86" height="59" rx="6" /><circle cx="122" cy="24" r="6" />
      <path d="m62 55 22-25 20 21 12-13 31 28" />
    </g>}
  </svg>;
}

function ModelCard({ model, selected, onCompare, onExamples }: { model: StudioModel; selected: boolean; onCompare: () => void; onExamples: () => void }) {
  const provider = modelProvider(model);
  const format = categories.find((item) => item.value === model.type);
  const FormatIcon = format?.icon || Box;
  const maintenance = model.config?.availabilityStatus === "maintenance";
  const resolutions = [...new Set(model.config?.resolutions || [])].slice(0, 4);
  const durations = model.type === "video" ? (model.config?.durations || []).slice(0, 2) : [];
  const description = model.desc && !/[\p{Script=Han}]/u.test(model.desc) ? model.desc : modelGuidance(model);
  const credits = catalogCreditValue(model);

  return <article className={styles.card} data-model-key={model.modelKey}>
    <Link className={styles.cardLink} aria-label={`Explore ${modelName(model)} in the studio${maintenance ? ", currently under maintenance" : ""}`} href={`/studio?type=${model.type}&model=${encodeURIComponent(model.modelKey || model.id)}`}>
      <div className={styles.visual} data-format={model.type}>
        <ModelIcon model={model} size="large" />
        <FormatIllustration type={model.type} />
        <span className={styles.format}><FormatIcon size={12} aria-hidden="true" />{format?.label || model.type}</span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.family}><span>{provider?.name || `${format?.label || "Creative"} model`}</span>{maintenance && <span className={styles.maintenance}><CircleAlert size={12} aria-hidden="true" />Maintenance</span>}</div>
        <h2>{modelName(model)}</h2>
        <p className={styles.description}>{description}</p>
        {(resolutions.length > 0 || durations.length > 0) && <ul className={styles.settings} aria-label="Model options">
          {resolutions.map((resolution) => <li key={resolution}>{resolution.toUpperCase()}</li>)}
          {durations.map((duration) => <li key={`duration-${duration}`}>{duration}</li>)}
        </ul>}
        <footer>
          <span className={styles.price}>{credits == null ? <><strong className={styles.variable}>Credits vary</strong><small>Estimate in the studio</small></> : <><strong>{number(credits)} <span>{credits === 1 ? "credit" : "credits"}</span></strong><small>per request</small></>}</span>
          <span className={styles.open}>{maintenance ? "View model" : "Explore"} <span><ArrowUpRight size={16} aria-hidden="true" /></span></span>
        </footer>
      </div>
    </Link><div className="model-card-actions"><button className="button small" aria-pressed={selected} onClick={onCompare}>{selected ? "Remove comparison" : "Compare"}</button><button className="button small" onClick={onExamples}>Examples</button></div>
  </article>;
}

export function Catalog({ providerId = "", initialModels = [] }: { providerId?: string; initialModels?: StudioModel[] }) {
  const [comparison, setComparison] = useState<string[]>([]);
  const [example, setExample] = usePreviewState<StudioModel>("model-examples");
  const [compareNotice, setCompareNotice] = useState("");
  const provider = MODEL_PROVIDERS.find((item) => item.id === providerId);
  const query = useSearchParams();
  const filter = categories.find((item) => item.value === query.get("type"))?.value || "all";
  const search = query.get("q") || "";
  const searchRef = useRef<HTMLInputElement>(null);
  const resource = useResource<StudioModel[]>("/api/market/studio-models");
  const available = useMemo(() => publicMediaModels(resource.data ?? initialModels).filter((model) => !provider || modelProvider(model)?.id === provider.id), [resource.data, initialModels, provider]);
  // Replace this history entry so Back returns to the chosen collection without
  // creating a history entry or requesting the catalog for every keystroke.
  const updateFilters = (nextFilter: string, nextSearch: string) => {
    const params = new URLSearchParams(window.location.search);
    if (nextFilter === "all") params.delete("type"); else params.set("type", nextFilter);
    if (nextSearch) params.set("q", nextSearch); else params.delete("q");
    const suffix = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}${window.location.hash}`);
  };
  const setFilter = (value: string) => updateFilters(value, search);
  const setSearch = (value: string) => updateFilters(filter, value);
  const models = available.filter((model) => (filter === "all" || model.type === filter) && `${modelName(model)} ${model.modelKey} ${modelProvider(model)?.name || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const families = MODEL_PROVIDERS.filter((item) => available.some((model) => modelProvider(model)?.id === item.id));
  const formatCount = new Set(available.map((model) => model.type)).size;
  const loading = resource.loading && initialModels.length === 0;
  const ready = !loading && (!resource.error || initialModels.length > 0);
  const filtering = Boolean(provider || filter !== "all" || search);
  const resetAction = provider
    ? <Link href="/models" className="button small">Reset filters <X size={13} aria-hidden="true" /></Link>
    : <button className="button small" onClick={() => { updateFilters("all", ""); searchRef.current?.focus(); }}>Reset filters <X size={13} aria-hidden="true" /></button>;

  return <PublicPage><div className={`wrap ${styles.collection}`}>
    <header className={styles.header}>
      <div>
        <p className="page-overline">The model collection</p>
        <h1>Find the right kind<br />of possibility<span>.</span></h1>
        <p className={styles.intro}>A different perspective for every idea. Find your model, choose a direction, and make it yours.</p>
      </div>
      {ready && available.length > 0 && <aside className={styles.overview} aria-label="Collection overview">
        <div className={styles.count}><strong>{number(available.length)}</strong><span>models to explore</span></div>
        <p>{formatCount} creative {formatCount === 1 ? "format" : "formats"}{families.length > 0 ? ` · ${families.length} model ${families.length === 1 ? "family" : "families"}` : ""}</p>
        {families.length > 0 && <div className={styles.familyIcons}>{families.slice(0, 6).map((family) => {
          const representative = available.find((model) => modelProvider(model)?.id === family.id)!;
          return <Link key={family.id} href={`/models?provider=${family.id}`} title={`Explore ${family.name}`} aria-label={`Explore ${family.name} models`}><ModelIcon model={representative} /></Link>;
        })}</div>}
      </aside>}
    </header>

    {provider && <div className={styles.providerFilter}><span>Models from <strong>{provider.name}</strong></span><Link className="button small" href="/models">View all providers <X size={13} aria-hidden="true" /></Link></div>}
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Filter models by format">
        {categories.map(({ value, label, icon: Icon }) => <button key={value} aria-pressed={filter === value} aria-label={label} onClick={() => setFilter(value)}>
          <Icon size={14} aria-hidden="true" /><span>{label}</span>
          {ready && <small aria-hidden="true">{value === "all" ? available.length : available.filter((model) => model.type === value).length}</small>}
        </button>)}
      </div>
      <div className={styles.search}><Search size={16} aria-hidden="true" /><input ref={searchRef} aria-label="Search models" placeholder="Find a model…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} />{search && <button onClick={() => { setSearch(""); searchRef.current?.focus(); }} aria-label="Clear search"><X size={14} aria-hidden="true" /></button>}</div>
    </div>
    {ready && <div className={styles.results}><span aria-live="polite">{models.length} {models.length === 1 ? "model" : "models"}{filter !== "all" ? ` · ${categories.find((item) => item.value === filter)?.label}` : " in the collection"}</span>{filtering && models.length > 0 ? resetAction : <span>Find a model. Make a start.</span>}</div>}
    {loading && <Loading label="Opening the collection…" />}
    {resource.error && <Alert>{resource.error}<button className="text-link" onClick={resource.refresh}>Try again</button></Alert>}
    {ready && !models.length && <EmptyState title={filtering ? "No matching models." : "Nothing here just yet."} description={filtering ? "Try another model name or start again with the full collection." : "Available models will appear here when they are published."} action={filtering ? resetAction : undefined} />}
    {compareNotice && <p role="status">{compareNotice}</p>}
    {comparison.length > 0 && <section className="model-comparison" aria-label="Model comparison"><div className="toolbar"><h2>Compare your options</h2><button className="button small" onClick={() => {setComparison([]);setCompareNotice("");}}>Clear comparison</button></div><p className="small muted">Capabilities come from the current catalog. Generation times and quality vary; no speed ranking or result guarantee is implied.</p><div className="table-wrap"><table><thead><tr><th>Model</th><th>Format</th><th>Supported settings</th><th>Credits</th><th>Try it</th></tr></thead><tbody>{available.filter(model => comparison.includes(model.id)).map(model => <tr key={model.id}><th>{modelName(model)}</th><td>{categories.find(c => c.value === model.type)?.label}</td><td>{modelGuidance(model)}</td><td>{catalogCreditValue(model) === null ? "Varies with settings — estimate in Studio" : `${number(catalogCreditValue(model)!)} per request`}</td><td><Link className="button small" href={`/studio?type=${model.type}&model=${encodeURIComponent(model.modelKey)}`}>Open Studio</Link></td></tr>)}</tbody></table></div></section>}
    <div className={styles.grid} aria-busy={loading}>
      {loading ? Array.from({ length: 6 }, (_, i) => <div key={i} className={styles.skeleton} aria-hidden="true"><span /><div><i /><i /><i /></div></div>) : models.map((model) => <ModelCard key={model.id} model={model} selected={comparison.includes(model.id)} onExamples={() => setExample(model)} onCompare={() => {setCompareNotice("");if(comparison.includes(model.id)) setComparison(comparison.filter(id => id !== model.id));else if(comparison.length < 3) setComparison([...comparison,model.id]);else setCompareNotice("Compare up to three models. Remove one before adding another.");}} />)}
    </div>
    <div className={styles.note}><SlidersHorizontal size={18} aria-hidden="true" /><p>Fine-tune resolution, format and creative controls in the studio. You&apos;ll see your credit estimate before you create.</p><Link href="/docs">Explore the model guide <ArrowRight size={15} aria-hidden="true" /></Link></div>
    {example && <Modal title="Published model examples" size="media" onClose={() => setExample(null)}><PublishedExamples model={example} /></Modal>}
  </div></PublicPage>;
}
