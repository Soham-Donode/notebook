# AGENTS.md

Notebook is a macOS infinite-canvas notebook: React 19 + Vite 8 + Tailwind v4 + Zustand + TipTap, packaged with Tauri 2. Nearly all logic is TypeScript in `src/`; the Rust side (`src-tauri/src/lib.rs`) only registers plugins.

## Commands

- `npm run dev` — Vite at `http://localhost:1420` (strict port). UI, canvas and imports work, but Tauri APIs silently no-op (`isTauriEnvironment()` is false).
- `npm run tauri dev` — the real app. Required to verify `~/Documents/Notebook` persistence, save dialogs and native clipboard.
- `npm run typecheck` — `tsc --noEmit -p .` (incremental, cached in `node_modules/.tmp`).
- `npm run build` — the only repo check: `tsc && vite build`. `noUnusedLocals`/`noUnusedParameters` are on, so unused imports fail the build.
- `npm run doctor` — checks Node, Rust, platform libraries and optional cross-build tools.
- `npm run build:current` — production installers for the host OS via `scripts/build.mjs`. Platform-specific aliases are `build:macos`, `build:windows`, `build:linux`; artifacts land in `builds/<platform>/` with checksums. The frontend build does not compile Rust; run `cargo check` in `src-tauri/` after Rust edits.
- `npm run build:macos -- --arch universal` builds a universal DMG; `--quality` switches to fat LTO for the smallest binary.
- No test runner or linter exists. Verify behavior in the dev server instead of adding new tooling. GitHub Actions (`.github/workflows/build.yml`) builds all three platforms and is the only CI config.

## Architecture

- Entry: `src/main.tsx` → `src/App.tsx`. `Canvas` owns pan/zoom/marquee/arrow/context-menu input, `WorldLayer` applies the single `translate(viewport.x, viewport.y) scale(zoom)` transform, and `CanvasElements` renders cards culled by `useVisibleElements` (600 px margin).
- Element geometry is canvas-space; the viewport is `{x, y, zoom}` per section. Convert with `screenToCanvas`/`canvasToScreen` from `src/utils/canvasMath.ts`; never persist screen coordinates.
- State split: `useNotesStore` (notebooks/sections/elements/viewport + undo, persisted), `useUiStore` (selection/editing/tool/import flags, transient), `useThemeStore` (light/dark in `localStorage`). Use narrow selectors — selecting the whole store re-renders every card during pointer moves.
- Undo is per-section, in memory, 50 steps. `addElement`/`addElements` snapshot automatically; live drags/resizes write with `commitUndo=false` and commit once on pointerup. Keep a new gesture to one undo entry.
- Adding an element type means updating the union in `src/types.ts`, the dispatch in `CanvasElements`, bounds in `useVisibleElements`, and clipboard/export/GC handling where relevant.

## Persistence (fails silently — read before touching storage)

- Notebook metadata is persisted by Zustand to `localStorage` key `notebook-v1`. Images are `Blob`s in IndexedDB via `idb-keyval` (keys `page:<uuid>:<n>` for pages, `img:<uuid>` for images), exposed as memoised object URLs by `src/store/imageStore.ts`. Never put data URLs or blobs in persisted state.
- In Tauri, `putPageImage` also mirrors images to `~/Documents/Notebook/<notebook folder>/images/<sanitized-key>.jpg`; notebooks autosave to `~/Documents/Notebook/<folder>/notebook.json` on a 350 ms debounce.
- Disk is authoritative at startup: `hydrateFromDisk()` replaces persisted state with what it finds on disk. Outside Tauri it finds nothing, so **browser-mode notebooks disappear on reload** — test persistence in `npm run tauri dev`.
- Deleting elements intentionally keeps blobs so undo can restore them; orphaned blobs are removed by `collectGarbage()` at startup. Deleting a notebook removes its folder and blobs. A new image-bearing element type or key prefix must be added to `collectGarbage`, the deletion paths, and App startup's live-key collection.
- `SCHEMA_VERSION` in `src/types.ts` is both the Zustand persist version and the notebook-bundle version. Bump it and extend `migrate` when the persisted shape changes.

## Share notebook (`.notebook` archives)

- `src/utils/notebookArchive.ts` exports a notebook as a ZIP named `<name>.notebook` from the home-screen kebab menu, and imports one via the circular button beside “New Notebook”. `fflate` handles packing/unpacking.
- Archive layout mirrors the on-disk notebook: `manifest.json` (format/version + old image key → archive path), `notebook.json` (local `folderName`/`folderPath` stripped), and `images/<sanitized-key>.jpg`.
- Import never trusts archive ids: notebook, section, element, `pdfId` and image keys are regenerated so the same archive can be imported twice and each copy deleted independently. Name/folder collisions become `Name (2)`, `Name (3)`, … via `findAvailableNotebookTarget()`.
- Images are written into `~/Documents/Notebook/<folder>/images/` with `saveImageToDisk`, not `putPageImage` (which targets the currently active notebook), then cached in IndexedDB. A failed import removes the half-written folder. Successful imports are added with `useNotesStore.addNotebook()` and opened immediately.
- Tauri uses the native open/save dialogs; browser dev mode downloads/uploads the archive and only keeps it in IndexedDB, so it still disappears on reload like any browser-mode notebook.
- `src/utils/bundle.ts` is an older, unwired JSON/base64 export path — don't add a second UI on top of it.

## Document import (`pdfProcessor.ts`, `documentProcessor.ts`, `pageSizing.ts`)

- Toolbar “Import” accepts PDF, DOCX and PPTX; `.doc`/`.ppt` are deliberately rejected with a toast. Every page/slide becomes an image-backed `pdf-page` element — the same model as PDFs.
- All formats are normalized by `pageSizing.ts`: 800 canvas units wide, height from the page's aspect ratio clamped to 0.55–1.65, rasterized ≈1600 px wide (max 2600 px tall). Don't reintroduce per-format widths.
- `docx-preview`: call `renderAsync(file, host, host, …)`. The third argument is a style container whose `innerHTML` the library clears — passing `document.head` would wipe app styles.
- `pptx-preview` silently renders 0 slides for some generated decks (observed with pptxgenjs); the importer then throws “No pages found”. Tested python-pptx decks import fine; this is a library limitation, not wrapper logic.
- `docx-preview` and `pptx-preview` are dynamically imported to keep them out of the startup bundle (`html2canvas-pro` is already pulled in by PDF export).

## PDF export (`exportPdf.ts`, `PdfExportDialog.tsx`)

- `PdfExportDialog` collects paper size, orientation and header/footer toggles, then drives `exportSectionToPdf`; it shows progress, can abort mid-render and returns to the save-dialog outcome on cancel. Don't add a second one-click export path.
- Layout takes the section's single bounding rectangle (top-left of the top-left-most element to bottom-right of the bottom-right-most element), fits its width to the printable page width, and slices it into equal-height horizontal strips. Each strip is one page, top to bottom, so elements that cross a cut continue on the next page. Arrows are composited onto the raster afterwards; every element, including `rect` and `arrow`, contributes to the bounding rectangle.
- Canvas units print at natural size (96 dpi) unless the rectangle is wider than the page, in which case it is scaled down to fit; it is never enlarged past 1:1. Each page is one offscreen DOM clone rasterised by `html2canvas-pro` at 200 dpi (≈1654 px wide for A4) and embedded as PNG. Don't go back to one html2canvas call per note.
- A4/Letter, auto/portrait/landscape, the background colour (presets + custom picker), the header rule and `n / N` footer are all optional and live in the dialog. The palette adjusts header/footer ink and flips default text/arrow/rect ink for dark backgrounds, and `onclone` strips the app's `dark` class so canvas styling does not leak into the export.
- In Tauri the native save dialog opens before any heavy work; dismissing it returns `{ saved: false }` and leaves the options visible. In the browser it falls back to `doc.save(filename)`.

## Toolchain constraints

- pdfjs needs all three: worker wired at module scope via `pdf.worker.mjs?url`, `optimizeDeps.include: ['pdfjs-dist']` plus `build.target: 'esnext'` in `vite.config.ts`, and Tauri CSP allowing `worker-src blob:` / `img-src blob:`. Removing one yields opaque worker/import failures.
- Tailwind v4 is CSS-first: the plugin lives in `vite.config.ts` and theme tokens in `@theme` in `src/index.css`. There is no `tailwind.config.js`.
- Use `html2canvas-pro`, never classic `html2canvas`: Tailwind v4 colors are `oklch()` and classic html2canvas throws. It powers PDF export and DOCX/PPTX rasterization.
- The `Promise.withResolvers` polyfill must stay at the very top of `src/main.tsx`, before imports (older WKWebView).
- New Tauri plugin = crate + `.plugin(...)` in `src-tauri/src/lib.rs` + permissions in `src-tauri/capabilities/default.json`. Missing capabilities fail at runtime, not at build.
- The window uses `titleBarStyle: "Overlay"`; keep the top `.drag-region` strip (and equivalents on full-screen screens) clear of pointer-events, or the window can't be dragged.

## Production builds

- `scripts/build.mjs` is the single build entry point. It detects the host, runs `tauri build` with the right bundles, copies artifacts into `builds/<platform>/` and writes `SHA256SUMS.txt`. Keep the npm aliases in `package.json` pointed at it.
- `src-tauri/Cargo.toml` intentionally uses thin LTO + 16 codegen units so release builds are fast. Do not put fat LTO back as the default; `--quality` sets `CARGO_PROFILE_RELEASE_LTO=fat` and `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1` for release-day builds.
- The macOS DMG window is configured in `bundle.macOS.dmg` in `tauri.conf.json`; its background is `src-tauri/icons/dmg-background.png` (660×400) and Tauri adds the `/Applications` symlink automatically. Use `tauri build --bundles app,dmg`, not a hand-rolled `hdiutil` image, or the drag-to-Applications layout is lost.
- `bundle.targets` is `"all"` in the base config; `tauri.<platform>.conf.json` narrows it per platform (`app,dmg`, `nsis`, `deb,appimage`), and the build script passes `--bundles` as well.
- Large frontend assets matter for build and install size. `public/bg.webp` replaced an 8.7 MB PNG; keep new background art compressed.

## Debugging

- Dev builds expose `window.__notebook.{notesStore,uiStore,imageStore}` (`src/main.tsx`) — drive the app from devtools or a headless-browser script without UI clicks.
- Cross-component commands are `window` events: `notebook-toast`, `notebook-open-command-palette`, `notebook-flip-arrow-draft`.
- `README.md` is the stock Tauri template and source comments cite a `§N` spec that no longer exists. Trust the code.
