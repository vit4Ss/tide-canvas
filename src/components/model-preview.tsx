"use client";
import { useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes } from "react";
import type { ModelViewerElement } from "@google/model-viewer";
import { Alert, Loading } from "./ui";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- React's intrinsic-element types use the JSX namespace.
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<HTMLAttributes<ModelViewerElement>, ModelViewerElement> & { src: string; poster?: string; alt: string; "camera-controls"?: boolean };
    }
  }
}

export function ModelPreview({ source, poster }: { source: string; poster?: string }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<ModelViewerElement | null>(null);
  useEffect(() => {
    let active = true;
    void import("@google/model-viewer").then(() => { if (active) setReady(true); }).catch(() => { if (active) setError("The 3D viewer could not load. Retry or download the original file."); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    const viewer = ref.current;
    if (!ready || !viewer) return;
    const timer = setTimeout(() => setError("The model is taking too long to load. Retry or download it to a compatible viewer."), 30_000);
    const complete = () => { clearTimeout(timer); setLoaded(true); setError(""); };
    const fail = () => { clearTimeout(timer); setError("This model could not be previewed. The file may be unavailable, unsupported or too large for this device. You can still try the original download."); };
    viewer.addEventListener("load", complete); viewer.addEventListener("error", fail);
    return () => { clearTimeout(timer); viewer.removeEventListener("load", complete); viewer.removeEventListener("error", fail); };
  }, [ready, attempt]);
  const reset = () => { if (ref.current) ref.current.cameraOrbit = "0deg 75deg 105%"; };
  return <div className="model-viewer-wrap">
    {!loaded && !error && <Loading label="Opening 3D preview…" />}
    {error && <Alert>{error}<button className="button small" onClick={() => { setError(""); setLoaded(false); setAttempt(n => n + 1); }}>Retry preview</button></Alert>}
    {ready && !error && <model-viewer key={attempt} ref={ref} src={source} poster={poster || undefined} alt="Interactive preview of your 3D creation" camera-controls touch-action="pan-y" interaction-prompt="none" aria-label="3D preview. Drag or use arrow keys to rotate; scroll to zoom." tabIndex={0} />}
    <div className="preview-controls"><p>Drag to rotate. Scroll or pinch to zoom. Keyboard: arrow keys.</p><button className="button small" disabled={!loaded} onClick={reset}>Reset view</button></div>
  </div>;
}
