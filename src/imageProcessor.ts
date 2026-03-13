/**
 * Image processing for note.com articles.
 *
 * Pipeline:
 * 1. Extract image references from markdown (local vs global)
 * 2. For each local image:
 *    a. Check if note.com supports the format (JPG, PNG, GIF, HEIC)
 *    b. Supported → use source file as-is
 *    c. Unsupported (SVG, WebP, BMP, TIFF, …) → convert to PNG in memory
 * 3. Hash source content (SHA-256)
 * 4. Skip upload if hash matches in-memory cache (same session, not expired)
 * 5. Upload to temporary hosting (ServiceManager handles fallback)
 * 6. Return URL map for preview / copy
 *
 * Image conversion uses Jimp (pure JS) for raster formats and
 * @resvg/resvg-wasm for SVG — no native binaries required.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  sha256,
  loadRegistry,
  rememberSourceRef,
  saveRegistry,
  uploadWithRegistry,
  type UrlMap,
} from './upload';
import { parseFrontmatter } from './frontmatter';
import {
  getConvertedUploadFileName,
  getUploadFileName,
  resolveLocalImageRefAsync,
} from './imageRefs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 1240; // 2x of 620px for Retina
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB (note.com limit)
const MIN_WIDTH = 620;
const UPLOAD_CONCURRENCY = 2;
const INTER_BATCH_DELAY_MS = 1000;

/** Formats that note.com accepts for article images. */
const NOTE_SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.heic']);

// ---------------------------------------------------------------------------
// resvg-wasm lazy initialization
// ---------------------------------------------------------------------------

let resvgInitialized = false;
let resvgInitPromise: Promise<void> | undefined;

async function ensureResvgWasm(extensionPath: string): Promise<void> {
  if (resvgInitialized) return;
  if (resvgInitPromise) return resvgInitPromise;
  resvgInitPromise = (async () => {
    const { initWasm } = await import('@resvg/resvg-wasm');
    const wasmPath = path.join(extensionPath, 'dist', 'resvg.wasm');
    const wasmBuffer = await fs.readFile(wasmPath);
    await initWasm(wasmBuffer);
    resvgInitialized = true;
  })();
  return resvgInitPromise;
}

// ---------------------------------------------------------------------------
// WebP WASM lazy initialization (@jsquash/webp)
// ---------------------------------------------------------------------------

let webpInitialized = false;
let webpInitPromise: Promise<void> | undefined;

async function ensureWebpWasm(extensionPath: string): Promise<void> {
  if (webpInitialized) return;
  if (webpInitPromise) return webpInitPromise;
  webpInitPromise = (async () => {
    const wasmPath = path.join(extensionPath, 'dist', 'webp_dec.wasm');
    const wasmBuf = await fs.readFile(wasmPath);
    const wasmModule = await WebAssembly.compile(wasmBuf);
    const { init } = await import('@jsquash/webp/decode.js');
    await init(wasmModule);
    webpInitialized = true;
  })();
  return webpInitPromise;
}

// ---------------------------------------------------------------------------
// Font loading for SVG text rendering
// ---------------------------------------------------------------------------

/** Cached font buffers — loaded once per session. */
let svgFontBuffers: Uint8Array[] | undefined;

/**
 * Load system fonts for resvg-wasm SVG text rendering.
 * WASM cannot use loadSystemFonts/fontFiles — font data must be passed as buffers.
 *
 * We load one Latin font AND one CJK (Japanese) font so that both Western
 * and Japanese text render correctly.  Each group uses a prioritised list;
 * the first file that can be read wins.
 */
async function getSvgFontBuffers(): Promise<Uint8Array[]> {
  if (svgFontBuffers !== undefined) return svgFontBuffers;

  // Each group: try candidates in order, keep the first that loads.
  const groups: string[][] =
    process.platform === 'win32'
      ? [
          // Latin
          ['C:\\Windows\\Fonts\\arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf'],
          // CJK
          [
            'C:\\Windows\\Fonts\\msgothic.ttc',
            'C:\\Windows\\Fonts\\meiryo.ttc',
            'C:\\Windows\\Fonts\\YuGothR.ttc',
          ],
        ]
      : process.platform === 'darwin'
        ? [
            // Latin
            [
              '/System/Library/Fonts/Supplemental/Arial.ttf',
              '/System/Library/Fonts/Geneva.ttf',
              '/System/Library/Fonts/SFNS.ttf',
            ],
            // CJK
            [
              '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
              '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
              '/Library/Fonts/Arial Unicode.ttf',
              '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc',
            ],
          ]
        : [
            // Latin
            [
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/usr/share/fonts/TTF/DejaVuSans.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            ],
            // CJK
            [
              '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
              '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
              '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
              '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
            ],
          ];

  const buffers: Uint8Array[] = [];
  for (const candidates of groups) {
    for (const p of candidates) {
      try {
        buffers.push(await fs.readFile(p));
        break; // one per group
      } catch {
        // try next candidate
      }
    }
  }
  svgFontBuffers = buffers;
  return svgFontBuffers;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file extension is natively supported by note.com.
 */
function isNoteSupported(ext: string): boolean {
  return NOTE_SUPPORTED_EXTS.has(ext.toLowerCase());
}

/**
 * Extract image references from markdown text.
 */
export function extractImageRefs(markdown: string): { local: string[]; global: string[] } {
  const local: string[] = [];
  const global: string[] = [];

  const categorize = (src: string): void => {
    if (/^https?:\/\//.test(src) || src.startsWith('data:')) {
      global.push(src);
    } else {
      local.push(src);
    }
  };

  // Frontmatter header image (also processed through the upload pipeline)
  const { data: frontmatter, content } = parseFrontmatter(markdown);
  if (frontmatter.header) {
    categorize(frontmatter.header);
  }

  // Inline images: ![alt](url) or ![alt](url "title")
  const inlineRe = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = inlineRe.exec(content)) !== null) {
    categorize(m[1]);
  }

  // HTML <img> tags (html: true is enabled in markdown-it)
  const imgTagRe = /<img\s[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((m = imgTagRe.exec(content)) !== null) {
    categorize(m[1]);
  }

  return { local, global };
}

/**
 * Convert an unsupported image to PNG.
 * For SVG: rasterize via resvg-wasm at high density then resize.
 * For others (WebP, BMP, TIFF, …): decode and re-encode as PNG via Jimp.
 * Retries at smaller widths if result exceeds 20 MB.
 */
async function convertToPng(
  srcBuffer: Buffer,
  ext: string,
  extensionPath: string,
  width = DEFAULT_WIDTH,
): Promise<Buffer> {
  const isSvg = ext === '.svg';
  let currentWidth = width;

  while (true) {
    let pngBuffer: Buffer;

    if (isSvg) {
      await ensureResvgWasm(extensionPath);
      const { Resvg } = await import('@resvg/resvg-wasm');
      const fontBuffers = await getSvgFontBuffers();
      const fontOpts = {
        fontBuffers,
        defaultFontFamily: 'sans-serif',
        loadSystemFonts: false,
      };
      // First pass: measure intrinsic size at native resolution
      const probe = new Resvg(srcBuffer.toString('utf-8'), { font: fontOpts });
      const intrinsicWidth = probe.width;
      // Only scale down, never up (withoutEnlargement equivalent)
      const targetWidth = Math.min(intrinsicWidth, currentWidth);
      const resvg = new Resvg(srcBuffer.toString('utf-8'), {
        fitTo: { mode: 'width', value: targetWidth },
        font: fontOpts,
      });
      const rendered = resvg.render();
      pngBuffer = Buffer.from(rendered.asPng());
    } else if (ext === '.webp') {
      // Jimp v1 has no WebP decoder — use @jsquash/webp to decode, then Jimp for PNG encode
      await ensureWebpWasm(extensionPath);
      const decode = (await import('@jsquash/webp/decode.js')).default;
      const imageData = await decode(
        srcBuffer.buffer.slice(
          srcBuffer.byteOffset,
          srcBuffer.byteOffset + srcBuffer.byteLength,
        ) as ArrayBuffer,
      );
      const { Jimp } = await import('jimp');
      const image = new Jimp({
        width: imageData.width,
        height: imageData.height,
        data: Buffer.from(imageData.data.slice().buffer as ArrayBuffer),
      });
      if (image.width > currentWidth) {
        image.resize({ w: currentWidth });
      }
      pngBuffer = Buffer.from(await image.getBuffer('image/png'));
    } else {
      const { Jimp } = await import('jimp');
      const image = await Jimp.read(srcBuffer);
      if (image.width > currentWidth) {
        image.resize({ w: currentWidth });
      }
      pngBuffer = Buffer.from(await image.getBuffer('image/png'));
    }

    if (pngBuffer.length <= MAX_BYTES || currentWidth <= MIN_WIDTH) {
      return pngBuffer;
    }

    currentWidth = Math.max(Math.floor(currentWidth * 0.9), MIN_WIDTH);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A single image ready for upload — may be the original or a converted copy. */
interface PreparedImage {
  /** Original source ref in the markdown document */
  sourceRef: string;
  /** Name to use when uploading (& as URL map key) */
  uploadName: string;
  /** The image data (read into memory) */
  data: Buffer;
  /** Whether this was converted from an unsupported format */
  converted: boolean;
}

/**
 * Process all local images referenced in the document:
 * - Convert unsupported formats to PNG in memory
 * - Upload via registry-aware uploader (2-concurrent batches)
 * - Return URL map
 */
export async function processImages(
  document: vscode.TextDocument,
  expiry = '72h',
  force = false,
  extensionPath?: string,
): Promise<UrlMap | null> {
  const articleDir = path.dirname(document.fileName);
  const markdown = document.getText();
  const refs = extractImageRefs(markdown);

  if (refs.local.length === 0) {
    vscode.window.showInformationMessage('ローカル画像が見つかりません');
    return null;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'note 画像を処理中',
      cancellable: true,
    },
    async (progress, token) => {
      const registry = loadRegistry(articleDir);
      const urlMap: UrlMap = {};
      let uploadCount = 0;
      let cachedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const usedServices = new Set<string>();

      // Phase 1: prepare images (convert if needed)
      progress.report({ message: '画像を解析中...' });
      const prepared: PreparedImage[] = [];

      for (const imgRef of refs.local) {
        if (token.isCancellationRequested) break;
        const resolved = await resolveLocalImageRefAsync(articleDir, imgRef);
        if (!resolved || !resolved.exists) {
          skippedCount++;
          continue;
        }

        const { sourceRef, diskPath: imgPath } = resolved;

        const ext = path.extname(imgPath).toLowerCase();
        const srcBuffer = await fs.readFile(imgPath);

        if (isNoteSupported(ext)) {
          // Supported format — use as-is
          prepared.push({
            sourceRef,
            uploadName: getUploadFileName(imgPath),
            data: srcBuffer,
            converted: false,
          });
        } else {
          // Unsupported format — convert to PNG
          const pngName = getConvertedUploadFileName(imgPath);

          // Check if source is already in registry (skip conversion too)
          const srcHash = sha256(srcBuffer);
          const existing = registry[srcHash];
          if (existing && !force) {
            urlMap[sourceRef] = existing.url;
            rememberSourceRef(existing, sourceRef);
            cachedCount++;
            continue; // Skip conversion + upload entirely
          }

          try {
            progress.report({
              message: `変換中: ${path.basename(imgPath)} → PNG`,
            });
            const pngBuffer = await convertToPng(srcBuffer, ext, extensionPath ?? '');
            prepared.push({
              sourceRef,
              uploadName: pngName,
              data: pngBuffer,
              converted: true,
            });
          } catch (err) {
            failedCount++;
            vscode.window.showErrorMessage(`変換失敗: ${path.basename(imgPath)} — ${err}`);
          }
        }
      }

      // Phase 2: parallel batch upload (2 concurrent)
      let completed = 0;
      const totalUploads = prepared.length;

      for (let batchStart = 0; batchStart < prepared.length; batchStart += UPLOAD_CONCURRENCY) {
        if (token.isCancellationRequested) break;

        const batch = prepared.slice(batchStart, batchStart + UPLOAD_CONCURRENCY);

        // Inter-batch delay (skip for first batch)
        if (batchStart > 0) {
          await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));
        }

        const results = await Promise.allSettled(
          batch.map(async (img) => {
            const result = await uploadWithRegistry(
              img.data,
              img.uploadName,
              img.sourceRef,
              registry,
              expiry,
              force,
            );
            return { img, result };
          }),
        );

        for (const r of results) {
          if (r.status === 'fulfilled') {
            const { img, result } = r.value;
            urlMap[img.sourceRef] = result.url;
            if (result.serviceName) usedServices.add(result.serviceName);
            if (result.cached) {
              cachedCount++;
            } else {
              uploadCount++;
            }
          } else {
            failedCount++;
            const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
            vscode.window.showErrorMessage(`アップロード失敗: ${reason}`);
          }
        }

        completed += batch.length;
        progress.report({
          message: `(${completed}/${totalUploads})`,
          increment: totalUploads > 0 ? (batch.length / totalUploads) * 100 : 0,
        });
      }

      // Phase 3: save registry & report
      saveRegistry(articleDir, registry);

      const converted = prepared.filter((p) => p.converted).length;
      const parts: string[] = [];
      if (converted > 0) parts.push(`${converted}件変換`);
      if (uploadCount > 0) parts.push(`${uploadCount}件アップロード`);
      if (cachedCount > 0) parts.push(`${cachedCount}件キャッシュ利用`);
      if (skippedCount > 0) parts.push(`${skippedCount}件スキップ`);
      if (failedCount > 0) parts.push(`${failedCount}件失敗`);

      const svcInfo = usedServices.size > 0 ? ` [${[...usedServices].join(', ')}]` : '';
      vscode.window.showInformationMessage(
        `画像処理完了: ${parts.join('、') || 'すべてキャッシュ利用'}${svcInfo}`,
      );

      return urlMap;
    },
  );
}
