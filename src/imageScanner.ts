import { parseFrontmatter, resolveEyecatch } from './frontmatter';
import { canonicalizeMarkdownImageRef, isExternalImageRef } from './imageRefs';

export interface ImageSourceRange {
  line: number;
  column: number;
  length: number;
}

export interface MarkdownImageReference {
  sourceRef: string;
  alt: string;
  line: number;
  column: number;
  length: number;
  kind: 'frontmatter' | 'inline' | 'reference' | 'html';
  altRange: ImageSourceRange;
  useRange: ImageSourceRange;
  titleRange?: ImageSourceRange;
}

interface ReferenceDefinition {
  sourceRef: string;
  line: number;
  column: number;
  length: number;
  titleRange?: ImageSourceRange;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function findClosingBracket(line: string, start: number): number {
  for (let i = start; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
      continue;
    }
    if (line[i] === ']') return i;
  }
  return -1;
}

function parseInlineDestination(
  line: string,
  openParen: number,
): { value: string; column: number; length: number; titleRange?: ImageSourceRange } | null {
  let cursor = openParen + 1;
  while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
  let destinationEnd: number;
  if (line[cursor] === '<') {
    const end = line.indexOf('>', cursor + 1);
    if (end < 0) return null;
    const result = {
      value: line.slice(cursor + 1, end),
      column: cursor + 1,
      length: end - cursor - 1,
    };
    destinationEnd = end + 1;
    return { ...result, titleRange: parseOptionalTitle(line, destinationEnd) };
  }

  const start = cursor;
  let nested = 0;
  for (; cursor < line.length; cursor++) {
    const char = line[cursor];
    if (char === '\\') {
      cursor++;
      continue;
    }
    if (char === '(') {
      nested++;
      continue;
    }
    if (char === ')') {
      if (nested === 0) break;
      nested--;
      continue;
    }
    if ((char === ' ' || char === '\t') && nested === 0) break;
  }
  if (cursor === start) return null;
  destinationEnd = cursor;
  return {
    value: line.slice(start, cursor),
    column: start,
    length: cursor - start,
    titleRange: parseOptionalTitle(line, destinationEnd),
  };
}

function parseOptionalTitle(line: string, destinationEnd: number): ImageSourceRange | undefined {
  const whitespaceStart = destinationEnd;
  let cursor = destinationEnd;
  while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
  if (cursor === whitespaceStart) return undefined;
  const opener = line[cursor];
  const closer = opener === '(' ? ')' : opener;
  if (opener !== '"' && opener !== "'" && opener !== '(') return undefined;
  cursor++;
  for (; cursor < line.length; cursor++) {
    if (line[cursor] === '\\') {
      cursor++;
      continue;
    }
    if (line[cursor] === closer) {
      return { line: 0, column: whitespaceStart, length: cursor + 1 - whitespaceStart };
    }
  }
  return undefined;
}

function findFencedLines(lines: string[]): boolean[] {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let marker = '';
  let length = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!marker) {
      const opening = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!opening) continue;
      marker = opening[1][0];
      length = opening[1].length;
      fenced[i] = true;
      continue;
    }
    fenced[i] = true;
    const escaped = marker === '`' ? '`' : '~';
    if (new RegExp(`^ {0,3}${escaped}{${length},}\\s*$`).test(lines[i])) {
      marker = '';
      length = 0;
    }
  }
  return fenced;
}

function maskExcludedSyntax(lines: string[]): string[] {
  let inHtmlComment = false;
  return lines.map((line) => {
    const chars = line.split('');
    let cursor = 0;
    while (cursor < chars.length) {
      if (inHtmlComment) {
        const end = line.indexOf('-->', cursor);
        const limit = end < 0 ? chars.length : end + 3;
        chars.fill(' ', cursor, limit);
        cursor = limit;
        if (end < 0) break;
        inHtmlComment = false;
        continue;
      }
      const start = line.indexOf('<!--', cursor);
      if (start < 0) break;
      const end = line.indexOf('-->', start + 4);
      const limit = end < 0 ? chars.length : end + 3;
      chars.fill(' ', start, limit);
      cursor = limit;
      if (end < 0) {
        inHtmlComment = true;
        break;
      }
    }

    const withoutComments = chars.join('');
    for (const match of withoutComments.matchAll(/(`+).*?\1/g)) {
      chars.fill(' ', match.index!, match.index! + match[0].length);
    }
    return chars.join('');
  });
}

function isEscaped(line: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function collectDefinitions(
  lines: string[],
  lineOffset: number,
  fencedLines: boolean[],
): Map<string, ReferenceDefinition> {
  const definitions = new Map<string, ReferenceDefinition>();
  for (let i = 0; i < lines.length; i++) {
    if (fencedLines[i]) continue;
    const match = lines[i].match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
    if (!match) continue;
    const sourceRef = match[2] ?? match[3];
    const rawValue = match[2] ? `<${match[2]}>` : match[3];
    const rawColumn = lines[i].indexOf(rawValue, match[0].indexOf(':') + 1);
    const column = rawColumn + (match[2] ? 1 : 0);
    const label = normalizeLabel(match[1]);
    if (definitions.has(label)) continue; // CommonMark: the first definition wins.
    const titleRange = parseOptionalTitle(lines[i], rawColumn + rawValue.length);
    definitions.set(label, {
      sourceRef: canonicalizeMarkdownImageRef(sourceRef),
      line: i + lineOffset,
      column,
      length: sourceRef.length,
      titleRange: titleRange ? { ...titleRange, line: i + lineOffset } : undefined,
    });
  }
  return definitions;
}

/** Parse Markdown, reference-style, HTML, and frontmatter image sources. */
export function scanImageReferences(markdown: string): MarkdownImageReference[] {
  const references: MarkdownImageReference[] = [];
  const parsed = parseFrontmatter(markdown);
  const originalLines = markdown.split('\n');

  const eyecatch = resolveEyecatch(parsed);
  if (eyecatch) {
    // Locate the frontmatter line carrying the eyecatch path (legacy `header:`,
    // `note-md: { eyecatch: ... }` flow, or block-style `  eyecatch: ...`).
    const refLine = originalLines.findIndex((line, index) => {
      return index > 0 && index < parsed.lineCount && line.includes(eyecatch);
    });
    const line = Math.max(refLine, 0);
    const column = refLine >= 0 ? originalLines[refLine].indexOf(eyecatch) : 0;
    references.push({
      sourceRef: eyecatch,
      alt: 'ヘッダー画像',
      line,
      column: Math.max(column, 0),
      length: eyecatch.length,
      kind: 'frontmatter',
      altRange: { line, column: 0, length: 0 },
      useRange: {
        line,
        column: Math.max(column, 0),
        length: eyecatch.length,
      },
    });
  }

  const lines = parsed.content.split('\n');
  const fencedLines = findFencedLines(lines);
  const scanLines = maskExcludedSyntax(lines);
  const definitions = collectDefinitions(scanLines, parsed.lineCount, fencedLines);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (fencedLines[lineIndex]) continue;
    const line = scanLines[lineIndex];
    const sourceLine = lineIndex + parsed.lineCount;

    for (const htmlMatch of line.matchAll(
      /<img\s[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*>/gi,
    )) {
      const rawSourceRef = htmlMatch[1] ?? htmlMatch[2];
      const sourceRef = canonicalizeMarkdownImageRef(rawSourceRef);
      const column = htmlMatch.index! + htmlMatch[0].indexOf(rawSourceRef);
      const altMatch = htmlMatch[0].match(/\balt\s*=\s*["']([^"']*)["']/i);
      const titleMatch = htmlMatch[0].match(/\s+title\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i);
      const altColumn = altMatch
        ? htmlMatch.index! + htmlMatch[0].indexOf(altMatch[1], altMatch.index)
        : htmlMatch.index!;
      references.push({
        sourceRef,
        alt: altMatch?.[1] ?? '',
        line: sourceLine,
        column,
        length: rawSourceRef.length,
        kind: 'html',
        altRange: { line: sourceLine, column: altColumn, length: altMatch?.[1].length ?? 0 },
        useRange: { line: sourceLine, column: htmlMatch.index!, length: htmlMatch[0].length },
        titleRange: titleMatch
          ? {
              line: sourceLine,
              column: htmlMatch.index! + titleMatch.index!,
              length: titleMatch[0].length,
            }
          : undefined,
      });
    }

    let cursor = 0;
    while ((cursor = line.indexOf('![', cursor)) >= 0) {
      if (isEscaped(line, cursor)) {
        cursor += 2;
        continue;
      }
      const altEnd = findClosingBracket(line, cursor + 2);
      if (altEnd < 0) break;
      const alt = line.slice(cursor + 2, altEnd);
      const next = line[altEnd + 1];

      if (next === '(') {
        const destination = parseInlineDestination(line, altEnd + 1);
        if (destination) {
          references.push({
            sourceRef: canonicalizeMarkdownImageRef(destination.value),
            alt,
            line: sourceLine,
            column: destination.column,
            length: destination.length,
            kind: 'inline',
            altRange: { line: sourceLine, column: cursor + 2, length: alt.length },
            useRange: { line: sourceLine, column: cursor, length: altEnd + 1 - cursor },
            titleRange: destination.titleRange
              ? { ...destination.titleRange, line: sourceLine }
              : undefined,
          });
        }
      } else {
        let label = alt;
        if (next === '[') {
          const labelEnd = findClosingBracket(line, altEnd + 2);
          if (labelEnd >= 0) label = line.slice(altEnd + 2, labelEnd) || alt;
        }
        const definition = definitions.get(normalizeLabel(label));
        if (definition) {
          references.push({
            ...definition,
            alt,
            kind: 'reference',
            altRange: { line: sourceLine, column: cursor + 2, length: alt.length },
            useRange: { line: sourceLine, column: cursor, length: altEnd + 1 - cursor },
          });
        }
      }
      cursor = altEnd + 1;
    }
  }

  return references;
}

export function categorizeImageReferences(markdown: string): {
  local: string[];
  global: string[];
} {
  const local: string[] = [];
  const global: string[] = [];
  for (const reference of scanImageReferences(markdown)) {
    if (isExternalImageRef(reference.sourceRef)) {
      global.push(reference.sourceRef);
    } else {
      local.push(reference.sourceRef);
    }
  }
  return { local, global };
}
