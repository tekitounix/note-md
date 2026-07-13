/**
 * Image processing for note.com articles.
 *
 * Pipeline:
 * 1. Extract image references from markdown (local vs global)
 * 2. Accept only bounded JPG, PNG, SVG, WebP, BMP, and TIFF input.
 * 3. Decode and re-encode every accepted image as metadata-free PNG.
 *    GIF, HEIC, AVIF, and unknown formats fail closed.
 * 4. Hash source content (SHA-256)
 * 5. Skip upload if hash matches in-memory cache (same session, not expired)
 * 6. Upload under an anonymous hash-derived filename.
 * 7. Return URL map for preview / copy.
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
import { categorizeImageReferences } from './imageScanner';
import { resolveLocalImageRefAsync } from './imageRefs';
import {
  detectEncodedImageFormat,
  imageFormatForExtension,
  NORMALIZABLE_IMAGE_EXTENSIONS,
  readEncodedImageDimensions,
  type ImageDimensions,
} from './imageDimensions';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 1240; // 2x of 620px for Retina
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB (note.com limit)
const MAX_TOTAL_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_PREPARED_BYTES = 100 * 1024 * 1024;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_COUNT = 50;
const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_IMAGE_DIMENSION = 8192;
const MIN_WIDTH = 620;
const UPLOAD_CONCURRENCY = 2;
const INTER_BATCH_DELAY_MS = 1000;
const MAX_CONVERSION_CACHE_BYTES = 64 * 1024 * 1024;

class ResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceLimitError';
  }
}

const conversionCache = new Map<string, Buffer>();
let conversionCacheBytes = 0;

export function resetImageProcessorCache(): void {
  conversionCache.clear();
  conversionCacheBytes = 0;
  svgFontBuffers = undefined;
}

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
  try {
    await resvgInitPromise;
  } catch (error) {
    resvgInitPromise = undefined;
    throw error;
  }
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
  try {
    await webpInitPromise;
  } catch (error) {
    webpInitPromise = undefined;
    throw error;
  }
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

function assertSafeDimensions(size: ImageDimensions, fileName: string): void {
  if (
    size.width > MAX_IMAGE_DIMENSION ||
    size.height > MAX_IMAGE_DIMENSION ||
    size.width * size.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(`${fileName}: 画像寸法が上限を超えています (${size.width}×${size.height}px)`);
  }
}

function assertEncodedDimensions(data: Buffer, ext: string, fileName: string): void {
  const actualFormat = detectEncodedImageFormat(data);
  const declaredFormat = imageFormatForExtension(ext);
  if (!actualFormat || !declaredFormat) {
    throw new Error(`${fileName}: 画像形式を安全に識別できません`);
  }
  if (actualFormat !== declaredFormat) {
    throw new Error(`${fileName}: 拡張子と実際の画像形式が一致しません`);
  }
  const actualExtension = actualFormat === 'jpeg' ? '.jpg' : `.${actualFormat}`;
  const size = readEncodedImageDimensions(data, actualExtension);
  if (!size && actualFormat !== 'svg') {
    throw new Error(`${fileName}: デコード前に画像寸法を安全に取得できません`);
  }
  if (size) assertSafeDimensions(size, fileName);
}

function anonymousUploadName(data: Buffer): string {
  return `note-md-${sha256(data).slice(0, 16)}.png`;
}

async function readFileBounded(filePath: string, maxBytes: number): Promise<Buffer> {
  const limitLabel = `${maxBytes / (1024 * 1024)}MB`;
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error(`画像が上限 ${limitLabel} を超えているか通常ファイルではありません`);
    }
    const expectedSize = stat.size;
    const buffer = Buffer.alloc(Math.min(expectedSize + 1, maxBytes + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error(`画像が上限 ${limitLabel} を超えています`);
    if (offset !== expectedSize) throw new Error('読み取り中に画像ファイルが変更されました');
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('画像処理をキャンセルしました'));
  return new Promise((resolve, reject) => {
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error('画像処理をキャンセルしました'));
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Extract image references from markdown text.
 */
export function extractImageRefs(markdown: string): { local: string[]; global: string[] } {
  return categorizeImageReferences(markdown);
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
      assertSafeDimensions({ width: probe.width, height: probe.height }, 'SVG');
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
      assertSafeDimensions({ width: imageData.width, height: imageData.height }, 'WebP');
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
      assertSafeDimensions({ width: image.width, height: image.height }, ext.toUpperCase());
      if (image.width > currentWidth) {
        image.resize({ w: currentWidth });
      }
      pngBuffer = Buffer.from(await image.getBuffer('image/png'));
    }

    if (pngBuffer.length <= MAX_BYTES) {
      return pngBuffer;
    }

    if (currentWidth <= MIN_WIDTH) {
      throw new Error('PNG 変換後も 20MB を超えています');
    }

    currentWidth = Math.max(Math.floor(currentWidth * 0.9), MIN_WIDTH);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A single normalized PNG ready for upload. */
interface PreparedImage {
  /** Original source ref in the markdown document */
  sourceRefs: string[];
  /** Name to use when uploading (& as URL map key) */
  uploadName: string;
  /** The image data (read into memory) */
  data: Buffer;
  /** Whether this image was normalized to PNG. */
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
  const uniqueLocalRefs = [...new Set(refs.local)];

  if (uniqueLocalRefs.length === 0) {
    vscode.window.showInformationMessage('ローカル画像が見つかりません');
    return null;
  }
  if (uniqueLocalRefs.length > MAX_IMAGE_COUNT) {
    throw new Error(`画像は一度に ${MAX_IMAGE_COUNT} 件まで処理できます`);
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'note 画像を処理中',
      cancellable: true,
    },
    async (progress, token) => {
      const abortController = new AbortController();
      token.onCancellationRequested?.(() => abortController.abort());
      const registry = loadRegistry(articleDir);
      const urlMap: UrlMap = {};
      let uploadCount = 0;
      let cachedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let totalSourceBytes = 0;
      let totalPreparedBytes = 0;
      const usedServices = new Set<string>();

      // Phase 1: prepare images (convert if needed)
      progress.report({ message: '画像を解析中...' });
      const prepared: PreparedImage[] = [];
      const preparedByHash = new Map<string, PreparedImage>();

      const addPrepared = (image: PreparedImage): void => {
        const dataHash = sha256(image.data);
        const existing = preparedByHash.get(dataHash);
        if (existing) {
          for (const sourceRef of image.sourceRefs) {
            if (!existing.sourceRefs.includes(sourceRef)) existing.sourceRefs.push(sourceRef);
          }
          return;
        }
        const projectedTotal = totalPreparedBytes + image.data.length;
        if (projectedTotal > MAX_TOTAL_PREPARED_BYTES) {
          throw new ResourceLimitError('送信準備済み画像の合計サイズが 100MB を超えています');
        }
        totalPreparedBytes = projectedTotal;
        preparedByHash.set(dataHash, image);
        prepared.push(image);
      };

      for (const imgRef of uniqueLocalRefs) {
        if (token.isCancellationRequested) {
          throw new Error('画像処理をキャンセルしました');
        }
        const resolved = await resolveLocalImageRefAsync(articleDir, imgRef);
        if (!resolved || !resolved.exists) {
          skippedCount++;
          continue;
        }

        const { sourceRef, diskPath: imgPath } = resolved;

        const ext = path.extname(imgPath).toLowerCase();
        if (!NORMALIZABLE_IMAGE_EXTENSIONS.has(ext)) {
          failedCount++;
          vscode.window.showErrorMessage(
            `安全に送信できない画像形式です: ${path.basename(imgPath)}。PNG または JPEG に変換してください`,
          );
          continue;
        }

        try {
          const inputLimit = ext === '.svg' ? MAX_SVG_BYTES : MAX_BYTES;
          const srcBuffer = await readFileBounded(imgPath, inputLimit);
          const projectedSourceBytes = totalSourceBytes + srcBuffer.length;
          if (projectedSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
            throw new ResourceLimitError('画像の合計サイズが 100MB を超えています');
          }
          totalSourceBytes = projectedSourceBytes;
          assertEncodedDimensions(srcBuffer, ext, path.basename(imgPath));
          abortController.signal.throwIfAborted();
          progress.report({
            message: `安全な PNG に変換中: ${path.basename(imgPath)}`,
          });
          const srcHash = sha256(srcBuffer);
          const cacheKey = `png-v2:${ext}:${srcHash}`;
          let pngBuffer = conversionCache.get(cacheKey);
          if (!pngBuffer) {
            pngBuffer = await convertToPng(srcBuffer, ext, extensionPath ?? '');
            abortController.signal.throwIfAborted();
            if (pngBuffer.length > MAX_BYTES) {
              throw new Error('PNG 変換後の画像が 20MB を超えています');
            }
            assertEncodedDimensions(pngBuffer, '.png', path.basename(imgPath));
            if (pngBuffer.length <= MAX_CONVERSION_CACHE_BYTES) {
              conversionCache.set(cacheKey, pngBuffer);
              conversionCacheBytes += pngBuffer.length;
            }
            while (conversionCacheBytes > MAX_CONVERSION_CACHE_BYTES) {
              const oldestKey = conversionCache.keys().next().value;
              if (!oldestKey) break;
              const oldest = conversionCache.get(oldestKey);
              conversionCache.delete(oldestKey);
              conversionCacheBytes -= oldest?.length ?? 0;
            }
          }
          addPrepared({
            sourceRefs: [sourceRef],
            uploadName: anonymousUploadName(pngBuffer),
            data: pngBuffer,
            converted: true,
          });
        } catch (err) {
          if (abortController.signal.aborted) {
            throw new Error('画像処理をキャンセルしました', { cause: err });
          }
          if (err instanceof ResourceLimitError) throw err;
          failedCount++;
          vscode.window.showErrorMessage(`変換失敗: ${path.basename(imgPath)} — ${err}`);
        }
      }

      // Phase 2: parallel batch upload (2 concurrent)
      let completed = 0;
      const totalUploads = prepared.length;

      for (let batchStart = 0; batchStart < prepared.length; batchStart += UPLOAD_CONCURRENCY) {
        if (token.isCancellationRequested) {
          throw new Error('画像処理をキャンセルしました');
        }

        const batch = prepared.slice(batchStart, batchStart + UPLOAD_CONCURRENCY);

        // Inter-batch delay (skip for first batch)
        if (batchStart > 0) {
          await delayWithSignal(INTER_BATCH_DELAY_MS, abortController.signal);
        }

        const results = await Promise.allSettled(
          batch.map(async (img) => {
            const result = await uploadWithRegistry(
              img.data,
              img.uploadName,
              img.sourceRefs[0],
              registry,
              expiry,
              force,
              abortController.signal,
              document.uri,
            );
            return { img, result };
          }),
        );

        if (abortController.signal.aborted) {
          throw new Error('画像処理をキャンセルしました');
        }

        for (const r of results) {
          if (r.status === 'fulfilled') {
            const { img, result } = r.value;
            const entry = registry[result.sha256];
            for (const sourceRef of img.sourceRefs) {
              urlMap[sourceRef] = result.url;
              if (entry) rememberSourceRef(entry, sourceRef);
            }
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

      const converted = prepared
        .filter((p) => p.converted)
        .reduce((count, image) => count + image.sourceRefs.length, 0);
      const parts: string[] = [];
      if (converted > 0) parts.push(`${converted}件変換`);
      if (uploadCount > 0) parts.push(`${uploadCount}件アップロード`);
      if (cachedCount > 0) parts.push(`${cachedCount}件キャッシュ利用`);
      if (skippedCount > 0) parts.push(`${skippedCount}件スキップ`);
      if (failedCount > 0) parts.push(`${failedCount}件失敗`);

      if (failedCount > 0 || skippedCount > 0) {
        throw new Error(
          `未処理のローカル画像があります（失敗 ${failedCount}件、スキップ ${skippedCount}件）`,
        );
      }

      const svcInfo = usedServices.size > 0 ? ` [${[...usedServices].join(', ')}]` : '';
      vscode.window.showInformationMessage(
        `画像処理完了: ${parts.join('、') || 'すべてキャッシュ利用'}${svcInfo}`,
      );

      return urlMap;
    },
  );
}
