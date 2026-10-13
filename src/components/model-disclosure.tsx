import Link from "next/link";
import { modelName } from "@/lib/brand";
import type { StudioModel } from "@/lib/api";
import styles from "./legal-document.module.css";

const formats = [["image", "Images"], ["video", "Video"], ["audio", "Audio"], ["3d", "3D"], ["upscale", "Enhancement"]] as const;
export function ModelDisclosure({ models, compact = false }: { models: StudioModel[]; compact?: boolean }) {
  return <div className={styles.models}>
    <p>{compact ? "Choose a generation model by name. Here are some of the image and video options in our current catalogue." : "Framelyn is an independent creative service. Generations use the third-party models named below. These are the model options published in our catalogue; naming a model does not imply endorsement or an official partnership with its developer."}</p>
    {models.length ? <dl>{formats.filter(([type]) => !compact || type === "image" || type === "video").map(([type,label]) => {
      const names = new Set<string>();
      const group = models.filter(model => {
        if (model.type !== type) return false;
        const name = modelName(model);
        if (names.has(name)) return false;
        names.add(name); return true;
      });
      if (!group.length) return null;
      const families = new Set<string>();
      const preview = group.filter(model => {
        const family = modelName(model).toLowerCase().replace(/\b[v]?\d.*$/, "").trim();
        if (families.has(family)) return false;
        families.add(family); return true;
      });
      const visible = compact ? preview.slice(0,4) : group;
      return <div key={type}><dt>{label}</dt><dd><ul>{visible.map(model => <li key={model.id}>
        <Link href={`/studio?type=${model.type}&model=${encodeURIComponent(model.modelKey || model.id)}`}>{modelName(model)}</Link>
        {!compact && model.config?.availabilityStatus === "maintenance" && <span> (under maintenance)</span>}
      </li>)}</ul>{compact && group.length > visible.length && <Link className={styles.more} href={`/models?type=${type}`}>View all {type} models</Link>}</dd></div>;
    })}</dl> : <p>The current model list could not be loaded. <Link href="/models">Open the model catalogue</Link> to retry; we do not substitute unverified model names.</p>}
    <p>{compact ? <>Framelyn is independent of these model developers. Outputs are AI-generated. <Link href="/terms#models">Read the model disclosure</Link>.</> : <>Choose a model by name in <Link href="/studio">Studio</Link> before generating. Availability, model options and credit costs can change; your selected model is recorded with the task. Outputs are AI-generated and may contain errors.</>}</p>
  </div>;
}
