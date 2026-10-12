"use client";

import { useState } from "react";
import { AudioLines, Box, Image as ImageIcon, ScanLine, Video } from "lucide-react";
import { modelProvider } from "@/lib/model-providers";
import styles from "./model-icon.module.css";

interface ModelIconProps {
  model: { type?: unknown; modelKey?: string; name?: string };
  size?: "small" | "large";
}

/** Local family logos identify the model, without making a provider request.
 * Unknown families and unavailable images keep a visible format icon. */
export function ModelIcon({ model, size = "small" }: ModelIconProps) {
  const provider = modelProvider(model);
  const source = provider ? `/model-icons/${provider.icon}.png` : "";
  const [failedSource, setFailedSource] = useState("");
  const Icon = model.type === "video" ? Video : model.type === "audio" ? AudioLines
    : model.type === "3d" ? Box : model.type === "upscale" ? ScanLine : ImageIcon;

  return <span className={`${styles.icon} ${size === "large" ? styles.large : styles.small}`} aria-hidden="true">
    {source && failedSource !== source
      ? <img src={source} alt="" width={size === "large" ? 32 : 20} height={size === "large" ? 32 : 20}
          className={provider?.monochrome ? styles.monochrome : undefined}
          onError={() => setFailedSource(source)} />
      : <Icon size={size === "large" ? 28 : 18} strokeWidth={1.6} />}
  </span>;
}
