export interface ImageDimensions {
  width: number;
  height: number;
}

export const NORMALIZABLE_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.svg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
]);

export type EncodedImageFormat = 'jpeg' | 'png' | 'svg' | 'webp' | 'bmp' | 'tiff';

/** Identify the encoded format from bounded file content, never from its name. */
export function detectEncodedImageFormat(data: Buffer): EncodedImageFormat | undefined {
  if (data.length >= 8 && data.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (data.length >= 2 && data.toString('ascii', 0, 2) === 'BM') return 'bmp';
  if (
    data.length >= 4 &&
    (data.toString('hex', 0, 4) === '49492a00' || data.toString('hex', 0, 4) === '4d4d002a')
  ) {
    return 'tiff';
  }
  const prefix = data
    .subarray(0, Math.min(data.length, 64 * 1024))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (/^(?:<\?xml\b[^>]*>\s*)?<svg\b/i.test(prefix)) return 'svg';
  return undefined;
}

/** Normalize a filename extension to the corresponding encoded format. */
export function imageFormatForExtension(extension: string): EncodedImageFormat | undefined {
  switch (extension.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'jpeg';
    case '.png':
      return 'png';
    case '.svg':
      return 'svg';
    case '.webp':
      return 'webp';
    case '.bmp':
      return 'bmp';
    case '.tif':
    case '.tiff':
      return 'tiff';
    default:
      return undefined;
  }
}

function dimensions(width: number, height: number): ImageDimensions | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}

function jpegDimensions(data: Buffer): ImageDimensions | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > data.length) break;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) break;
    if (sofMarkers.has(marker) && length >= 7) {
      return dimensions(data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  return undefined;
}

function webpDimensions(data: Buffer): ImageDimensions | undefined {
  if (
    data.length < 30 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return undefined;
  }
  const kind = data.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    const width = 1 + data.readUIntLE(24, 3);
    const height = 1 + data.readUIntLE(27, 3);
    return dimensions(width, height);
  }
  if (kind === 'VP8 ' && data.toString('hex', 23, 26) === '9d012a') {
    return dimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
  }
  if (kind === 'VP8L' && data[20] === 0x2f && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return undefined;
}

function svgDimensions(data: Buffer): ImageDimensions | undefined {
  const source = data.subarray(0, Math.min(data.length, 64 * 1024)).toString('utf8');
  const tag = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return undefined;
  const width = Number(tag.match(/\bwidth\s*=\s*["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i)?.[1]);
  const height = Number(tag.match(/\bheight\s*=\s*["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i)?.[1]);
  const explicit = dimensions(width, height);
  if (explicit) return explicit;
  const viewBox = tag
    .match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return viewBox?.length === 4 ? dimensions(viewBox[2], viewBox[3]) : undefined;
}

function tiffDimensions(data: Buffer): ImageDimensions | undefined {
  if (data.length < 8) return undefined;
  const byteOrder = data.toString('ascii', 0, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return undefined;
  const readUInt16 = (offset: number): number =>
    littleEndian ? data.readUInt16LE(offset) : data.readUInt16BE(offset);
  const readUInt32 = (offset: number): number =>
    littleEndian ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
  if (readUInt16(2) !== 42) return undefined;
  const ifdOffset = readUInt32(4);
  if (ifdOffset + 2 > data.length) return undefined;
  const count = readUInt16(ifdOffset);
  let width: number | undefined;
  let height: number | undefined;
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > data.length) return undefined;
    const tag = readUInt16(entry);
    if (tag !== 256 && tag !== 257) continue;
    const type = readUInt16(entry + 2);
    const valueCount = readUInt32(entry + 4);
    if (valueCount !== 1 || (type !== 3 && type !== 4)) continue;
    const value = type === 3 ? readUInt16(entry + 8) : readUInt32(entry + 8);
    if (tag === 256) width = value;
    if (tag === 257) height = value;
  }
  return width !== undefined && height !== undefined ? dimensions(width, height) : undefined;
}

/** Read dimensions from bounded image headers without decoding pixel data. */
export function readEncodedImageDimensions(
  data: Buffer,
  extension: string,
): ImageDimensions | undefined {
  const ext = extension.toLowerCase();
  if (ext === '.png' && data.length >= 24 && data.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return dimensions(data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if ((ext === '.gif' || ext === '.gif87a' || ext === '.gif89a') && data.length >= 10) {
    return dimensions(data.readUInt16LE(6), data.readUInt16LE(8));
  }
  if (ext === '.jpg' || ext === '.jpeg') return jpegDimensions(data);
  if (ext === '.webp') return webpDimensions(data);
  if (ext === '.bmp' && data.length >= 26 && data.toString('ascii', 0, 2) === 'BM') {
    return dimensions(Math.abs(data.readInt32LE(18)), Math.abs(data.readInt32LE(22)));
  }
  if (ext === '.svg') return svgDimensions(data);
  if (ext === '.tif' || ext === '.tiff') return tiffDimensions(data);
  return undefined;
}
