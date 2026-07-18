source visual truth path:
- /mnt/c/Users/10062/AppData/Local/Temp/tmp5428.png (LibTV full canvas)
- /mnt/c/Users/10062/AppData/Local/Temp/tmp9E70.png (LibTV image node and composer)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpBB4E.png (LibTV image parameter panel)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpD6C6.png (LibTV model menu)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpE889.png (LibTV model menu and composer)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpE75C.png (TideCanvas pre-fix covered count menu)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpA9BD.png (TideCanvas pre-redesign floating asset panel)
- /mnt/c/Users/10062/AppData/Local/Temp/tmp7BC2.png (LibTV docked canvas/assets sidebar reference)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpC8BB.png (TideCanvas pre-fix image-parameter panel remaining open after focus moved away)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpB50C.png (LibTV selected-edge blue travelling-light reference)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpBA36.png (TideCanvas pre-fix selected image border/radius mismatch)
- /mnt/c/Users/10062/AppData/Local/Temp/tmp7055.png (TideCanvas selected image showing a light seam between media and selection outline)
- /mnt/c/Users/10062/AppData/Local/Temp/tmpA39B.png (TideCanvas video node with asymmetric left/right connection-handle spacing)
- /mnt/c/Users/10062/AppData/Local/Temp/tmp51C.png (TideCanvas pre-optimization video-parameter panel with excessive height and uneven option density)

implementation screenshot path: unavailable after the latest canvas rebuild — this session has no browser/screenshot connector or user-selected browser capture.

viewport: desktop references, including 2048 × 1045 full canvas and focused node/menu captures.

state: image-generation node selected; light theme; model, image-parameter, and independent batch-count menus; docked canvas/assets sidebar; equivalent dark theme also implemented.

**Full-view comparison evidence**

All supplied source screenshots were opened at original resolution. The LibTV full-canvas reference establishes a soft dotted canvas, compact floating top controls, a centered bottom tool dock, neutral node selection, white cards, restrained borders, and low-elevation shadows. TideCanvas now uses one scoped canvas token system for those surfaces and a derived low-glare dark palette. A browser-rendered post-build full view is unavailable, so final visual comparison remains blocked.

The asset-sidebar reference establishes a 284px near-full-height dock, compact identity/project rows, `画布 / 资产` tabs, a dense searchable node list, and a persistent footer count. The former floating thumbnail card has been replaced with that information architecture while keeping TideCanvas branding and existing asset operations.

**Focused region comparison evidence**

- `tmpE75C.png` proves the old independent batch menu opened inside the transformed node layer and was covered below the composer.
- `tmpBB4E.png` establishes the compact 5-column, individually outlined parameter choices and restrained neutral selected state.
- `tmpD6C6.png` and `tmpE889.png` establish a scrollable model menu with a muted selected row, model metadata, and viewport-safe placement.
- `tmpA9BD.png` shows the former floating asset card colliding with canvas chrome; `tmp7BC2.png` establishes the replacement docked hierarchy and compact list density.
- `tmpC8BB.png` records the image-parameter overlay remaining visible after attention moved back to the canvas.
- `tmpB50C.png` establishes the selected-edge treatment: a fixed blue path with a brighter source-to-target travelling segment, while unrelated edges remain neutral.
- `tmpBA36.png` shows the prior image-node selection border not following the media edge/radius closely enough.
- `tmp7055.png` confirms radius alignment improved but the card's native light 1px border remained visible as a seam inside the darker selection outline.
- `tmpA39B.png` shows the video card rendered at 608px inside a stale 620px node container while React Flow anchored handles to `contentW`, producing unequal side gaps.
- `tmp51C.png` shows the video-parameter panel using oversized ratio tiles, an awkwardly wrapped smart-ratio label, and full-width duration/audio rows that make the overlay unnecessarily tall and visually unbalanced.
- Post-fix focused captures are unavailable. The implementation now portals batch, model, image-parameter, and video-parameter overlays above React Flow and coordinates them as mutually exclusive overlays.

**Findings**

- [P2] Post-build rendered fidelity is not yet evidenced
  Location: full canvas, image composer, model/parameter/count menus, canvas/assets sidebar, light and dark themes.
  Evidence: source and pre-fix screenshots are available, but there is no browser capture after the Docker rebuild.
  Impact: exact spacing, menu anchoring, stacking, and dark-token balance cannot be signed off from code/build output alone.
  Fix: refresh the existing canvas and capture the full light canvas plus focused open model, parameter, and count states; repeat once in dark mode.

**Open Questions**

- None about scope or behavior. The user confirmed canvas-only scope, retained functionality, structural freedom, independent count button, and a derived dark theme.

**Implementation Checklist**

- [x] Preserve the independent batch-count trigger.
- [x] Render the batch menu through a fixed Portal so React Flow transforms/overflow cannot cover it.
- [x] Add viewport flip/shift behavior and bounded scrolling for all primary menus.
- [x] Make model, image parameters, video parameters, batch count, style modal, and add-node menu mutually exclusive.
- [x] Close active overlays on outside click, canvas click, or Escape.
- [x] Introduce scoped LibTV-inspired light/dark canvas tokens.
- [x] Restyle canvas background, top controls, bottom dock, empty state, node composers, handles, selection, context menu, quick-add menu, and shared popovers.
- [x] Restyle image parameters to the compact 5-column outlined layout.
- [x] Add full dark treatment to shared menus and the image-style picker.
- [x] Replace the floating asset card with a near-full-height docked sidebar.
- [x] Add `画布 / 资产` views, filters, expandable search, compact rows, and footer totals.
- [x] Make canvas rows select and smoothly center their corresponding node.
- [x] Preserve add-to-canvas, refresh, and confirmed-delete behavior for stored assets.
- [x] Close primary canvas popovers on captured outside pointer input, focus leaving the trigger/panel, window blur, or Escape—even when React Flow controls stop event propagation.
- [x] Add a custom React Flow edge with a 1.5s source-to-target blue travelling-light loop.
- [x] Activate the animation only for the explicitly selected edge or edges directly connected to any selected node; leave handles unchanged.
- [x] Provide a static blue selected state under `prefers-reduced-motion`.
- [x] Replace per-node selected rings with a shared 2px neutral-gray exterior outline on each node's main content surface.
- [x] Preserve each surface's own border radius and exclude floating tools, parameter panels, handles, and auxiliary chrome.
- [x] Merge native-border surfaces into a continuous 1px inner + 1px outer neutral stroke to remove the light seam without covering media.
- [x] Synchronize video `width/height`, `contentW/contentH`, and rendered root width so both handles share the same card-edge reference.
- [x] Compact the video-parameter overlay into a 5-column ratio grid with shorter labels, consistent 12px controls, and paired duration/audio sections while preserving every configured option.
- [x] Pass ESLint, TypeScript checks, Next.js production build, Docker health, and HTTP 200 checks.
- [ ] Capture and compare the revised rendered states.

**Follow-up Polish**

- Defer any pixel-level spacing adjustments until the post-build captures are available.

comparison history:
- Iteration 1: `tmp9859.png`/`tmp493A.png` exposed inconsistent dropdown placement and a problematic count trigger.
- Iteration 2: LibTV screenshots defined the selected canvas direction, node composer, model list, and parameter-panel hierarchy.
- Iteration 3: `tmpE75C.png` confirmed the count menu was present but covered by the canvas stacking context.
- Iteration 4: `tmpA9BD.png` and `tmp7BC2.png` defined the asset-management sidebar redesign.
- Iteration 5: `tmp51C.png` identified the video-parameter overlay's excessive height, wrapped smart-ratio label, and inconsistent control density; the panel was compacted without removing any model-configured options.
- Fixes applied: fixed Portal overlays, exclusive-open coordinator, viewport-aware positioning, independent count control, canvas-wide light/dark tokens, LibTV-inspired shared UI, and a docked dual-view canvas/assets navigator.
- Post-fix visual evidence: unavailable; production build and health checks are not treated as visual evidence.

primary interactions tested: static/type/build validation and local route availability. Browser pointer/keyboard interaction testing is unavailable.

console errors checked: blocked — no browser console is available.

final result: blocked
