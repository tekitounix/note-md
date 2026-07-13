import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { decodeHTML } from 'entities';

const UNSUPPORTED_IMAGE_EXT_RE = /\.(svg|webp|bmp|tiff?)$/i;
const MARKDOWN_ESCAPED_PUNCTUATION_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g;

export interface LocalImageRefInfo {
  sourceRef: string;
  diskPath: string;
  exists: boolean;
}

/** Decode the transformations Markdown applies to an image destination. */
export function canonicalizeMarkdownImageRef(src: string): string {
  return decodeHTML(src).replace(MARKDOWN_ESCAPED_PUNCTUATION_RE, '$1');
}

export function isExternalImageRef(src: string): boolean {
  const value = src.trim();
  if (/^[a-z]:[\\/]/i.test(value)) return false;
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

/** External image forms that the renderer and Webview CSP intentionally allow. */
export function isSafeExternalImageRef(src: string): boolean {
  const value = src.trim();
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
    return value.length <= 2 * 1024 * 1024;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === ''
    );
  } catch {
    return false;
  }
}

export function normalizeImageRef(src: string): string {
  let decoded = src.replace(MARKDOWN_ESCAPED_PUNCTUATION_RE, '$1');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Invalid percent escapes are treated as literal filename characters.
  }
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'));
  return normalized.replace(/^(?:\.\/)+/, '');
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveLocalImageRef(articleDir: string, imgRef: string): LocalImageRefInfo | null {
  const sourceRef = normalizeImageRef(imgRef);
  const candidatePath = path.resolve(articleDir, sourceRef);
  if (!isWithin(articleDir, candidatePath)) return null;
  if (!fs.existsSync(candidatePath)) {
    return { sourceRef, diskPath: candidatePath, exists: false };
  }

  const articleReal = fs.realpathSync(articleDir);
  const imageReal = fs.realpathSync(candidatePath);
  if (!isWithin(articleReal, imageReal)) return null;

  return { sourceRef, diskPath: imageReal, exists: true };
}

/** Async version of resolveLocalImageRef — avoids blocking the event loop. */
export async function resolveLocalImageRefAsync(
  articleDir: string,
  imgRef: string,
): Promise<LocalImageRefInfo | null> {
  const sourceRef = normalizeImageRef(imgRef);
  const candidatePath = path.resolve(articleDir, sourceRef);
  if (!isWithin(articleDir, candidatePath)) return null;

  try {
    await fsp.access(candidatePath);
  } catch {
    return { sourceRef, diskPath: candidatePath, exists: false };
  }

  const articleReal = await fsp.realpath(articleDir);
  const imageReal = await fsp.realpath(candidatePath);
  if (!isWithin(articleReal, imageReal)) return null;

  return { sourceRef, diskPath: imageReal, exists: true };
}

export function resolveMappedImageUrl(
  urlMap: Record<string, string> | undefined,
  src: string,
): string | undefined {
  if (!urlMap) return undefined;

  const normalized = normalizeImageRef(src);
  const keys: string[] = [normalized];
  if (UNSUPPORTED_IMAGE_EXT_RE.test(normalized)) {
    keys.push(normalized.replace(UNSUPPORTED_IMAGE_EXT_RE, '.png'));
  }

  for (const key of keys) {
    if (urlMap[key]) return urlMap[key];
  }
  return undefined;
}
