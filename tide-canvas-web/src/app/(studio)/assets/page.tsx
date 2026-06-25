"use client";

/* ============================================================================
   资产 · Assets route — renders the shared <AssetsBrowser/> inside the (studio)
   ws-rail layout. The browse/upload logic lives in the reusable component so the
   创作台 参考图「从资产库选取」dialog can render the exact same UI as a picker.
   ========================================================================== */

import { AssetsBrowser } from "@/components/studio/assets-browser";

export default function AssetsPage() {
  return <AssetsBrowser />;
}
