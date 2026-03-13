# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build**: `npm run compile` (tsc + esbuild)
- **Test**: `npm test` (compile + `node --test test/*.test.js`)
- **Type check**: `npm run typecheck`
- **Watch**: `npm run watch` (esbuild --watch)
- **Package**: `npm run package` (production build, minified)
- **Lint**: `npm run lint`
- **Format**: `npm run format`

Tests use Node.js built-in `node:test`. Test files are `test/*.test.js`.

## Architecture

Extension Host handles Markdown parsing, image processing, and validation. Webview handles display and user interaction.

### Key modules (src/)

- **extension.ts** — Entry point. Command registration, event subscriptions, validator wiring
- **previewPanel.ts** — Single WebviewPanel lifecycle. Generation counter prevents stale messages
- **render.ts** — markdown-it based note-style HTML generation. TOC, ruby, math conversion, char count, Webview CSS/JS templates
- **validator.ts** — Diagnostic rules for note-incompatible syntax. `change` trigger (during editing) vs `save` trigger (I/O rules)
- **codeActions.ts** — QuickFix CodeActions from validator diagnostics
- **imageProcessor.ts** — Local image extraction, jimp/resvg-wasm PNG conversion, upload
- **imageRefs.ts** — Image ref normalization, articleDir constraint, symlink escape prevention
- **upload.ts** — SHA-256 session-only upload cache (no disk persistence)
- **services.ts** — Temporary hosting service abstraction with health check and priority fallback
- **consent.ts** — Upload consent dialog management

### Build

- TypeScript → `out/` (tsc with declarations)
- esbuild bundles `src/extension.ts` → `dist/extension.js` (CJS, node18)
- `vscode` is external

### Design decisions

- Single preview panel follows active editor
- note compatibility logic is Markdown-source-based, not DOM post-processing
- Upload results are memory-only, no disk persistence
- Validator preprocessor marks code blocks, math blocks, and `<!-- note-ignore-next-line -->` as protected lines excluded from rules
