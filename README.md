# Notebook

An infinite-canvas notebook for macOS. Import PDFs, Word documents and PowerPoint slides, place images and notes anywhere, connect ideas with arrows, and export the result as a PDF.

<!-- Screenshot: save your capture as docs/screenshot.png -->
<img width="1470" height="923" alt="image" src="https://github.com/user-attachments/assets/cffdd18d-2837-4ed8-99bb-384d66621a6e" />

## Features

- **Infinite canvas** — pan, zoom and arrange everything freely on a dot grid.
- **Bring your documents** — PDF, Word (`.docx`) and PowerPoint (`.pptx`) files become consistently sized page cards. Images can be attached or pasted in.
- **Notes and arrows** — rich-text notes with font, size, color and weight controls, plus curved arrows for connecting ideas.
- **Stay organised** — notebooks and sections, search, multi-select, duplicate, copy/paste, and lock imported pages in place.
- **Export** — turn any section into a PDF in one click.
- **Local-first** — all notebooks are stored on your Mac. No account, no cloud.
- **Native feel** — light and dark themes, native save dialogs, and keyboard shortcuts throughout.

## Tech stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · TipTap · pdf.js · docx-preview · pptx-preview · jsPDF

## Getting started

Requirements: macOS, Node.js 20.19+, the Rust toolchain, and Xcode Command Line Tools.

```bash
npm install
npm run tauri dev
```

To preview the interface in a browser:

```bash
npm run dev   # http://localhost:1420
```

The browser preview is for UI work only — native storage and save dialogs need the desktop app.

## Using it

1. Create a notebook and add sections from the sidebar.
2. Click **Import** to add a PDF, Word or PowerPoint file; use the paperclip button for images.
3. Double-click the canvas to start writing, and press **A** to draw arrows.
4. Export the current section from the toolbar's overflow menu.

## Building

```bash
npm run build        # type-check + frontend bundle
npm run tauri build  # unsigned .app
npm run build:dmg    # DMG for Apple silicon
```

The `.app` and DMG are written to `src-tauri/target/release/bundle/`.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Search / command palette | ⌘K |
| Toggle sidebar | ⌘B |
| Back to notebooks | ⌘J |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Zoom in / out / reset | ⌘+ / ⌘− / ⌘0 |
| Select tool | V |
| Hand tool | H |
| Arrow tool | A |
| New text note | T (or double-click the canvas) |
| Select all / duplicate | ⌘A / ⌘D |
| Delete selection | ⌫ |
| Pan | Space + drag, middle-drag, or two-finger scroll |
| Zoom | ⌘ + scroll or trackpad pinch |
| Flip an arrow's curve while drawing | A |

## Storage

Notebooks are saved to `~/Documents/Notebook/<notebook>/notebook.json`, with imported pages and images in the matching `images/` folder. Metadata and image data are also cached locally for fast startup.

The browser preview keeps data in the browser only: it will not appear in `~/Documents` and does not survive a reload.

## Development

Architecture notes, commands and toolchain gotchas are documented in [AGENTS.md](AGENTS.md).
