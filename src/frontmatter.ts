import { parseDocument } from 'yaml';

/**
 * Parse YAML frontmatter from a Markdown document.
 *
 * YAML is decoded with the core schema, duplicate keys are rejected, aliases
 * are disabled, and only the fields consumed by note-md are projected into the
 * public result. Other tools' frontmatter keys remain ignored.
 *
 * Recognition contract:
 *   note-md:                     -> note article, defaults
 *   note-md: true                -> note article, defaults
 *   note-md: false               -> explicit opt-out (NOT a note article)
 *   note-md: { eyecatch: a.png } -> note article, flow-style config
 *   note-md:                     -> note article, block-style config
 *     eyecatch: a.png
 *
 * Example:
 * ```markdown
 * ---
 * note-md: { eyecatch: figures/header.png }
 * ---
 *
 * # Article title
 * ```
 */

/** The highest `note-md.version` this build understands. */
export const NOTE_MD_SCHEMA_VERSION = 1;

export interface Frontmatter {
  /** Legacy top-level eyecatch image path (relative to the article file) */
  header?: string;
  /** Raw top-level key-value pairs from frontmatter */
  [key: string]: string | undefined;
}

/** Parsed fields under the `note-md` marker. */
export interface NoteMdConfig {
  /** Eyecatch image path (relative to the article file), preview-only */
  eyecatch?: string;
  /** Header-format version the author pinned (usually absent) */
  version?: number;
}

export interface NoteMdMarker {
  /** True when a `note-md` key is present in frontmatter (any value). */
  hasMarker: boolean;
  /** True when the marker is explicitly `note-md: false`. */
  optOut: boolean;
  /** Optional scalar fields under the marker. */
  config: NoteMdConfig;
}

export interface ParseResult {
  /** Parsed top-level flat values (empty object if no frontmatter) */
  data: Frontmatter;
  /** Markdown content with frontmatter stripped */
  content: string;
  /** Number of lines occupied by frontmatter (including delimiters), 0 if none */
  lineCount: number;
  /** The note-md recognition marker */
  noteMd: NoteMdMarker;
  /** Safe, user-facing parse failure marker for malformed frontmatter. */
  frontmatterError?: string;
}

/** Maximum number of lines scanned while looking for the closing `---` fence. */
export const MAX_FRONTMATTER_LINES = 100;
/** Avoid parsing an unexpectedly large YAML document from the editor thread. */
const MAX_FRONTMATTER_BYTES = 128 * 1024;

const EMPTY_MARKER: NoteMdMarker = { hasMarker: false, optOut: false, config: {} };

/**
 * Whether a parsed document is a note article: the `note-md` marker is present
 * and not an explicit opt-out.
 */
export function isNoteArticle(parsed: ParseResult): boolean {
  return parsed.noteMd.hasMarker && !parsed.noteMd.optOut;
}

/** Resolve the eyecatch: prefer `note-md.eyecatch`, fall back to legacy `header`. */
export function resolveEyecatch(parsed: ParseResult): string | undefined {
  return parsed.noteMd.config.eyecatch ?? parsed.data.header;
}

/**
 * Parse frontmatter from the beginning of a Markdown string.
 * Returns the parsed key-value pairs, the note-md marker, and remaining content.
 */
export function parseFrontmatter(markdown: string): ParseResult {
  const lines = markdown.split('\n');
  if (lines[0]?.trimEnd() !== '---') {
    return { data: {}, content: markdown, lineCount: 0, noteMd: EMPTY_MARKER };
  }

  // Find closing "---"
  let endIndex = -1;
  for (let i = 1; i < lines.length && i <= MAX_FRONTMATTER_LINES; i++) {
    if (lines[i].trimEnd() === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    const boundedBody = lines.slice(1, MAX_FRONTMATTER_LINES + 1).join('\n');
    return {
      data: {},
      content: markdown,
      lineCount: Math.min(lines.length, MAX_FRONTMATTER_LINES + 1),
      noteMd: recoverNoteMdMarker(boundedBody),
      frontmatterError: `frontmatter の閉じ区切り (---) が ${MAX_FRONTMATTER_LINES} 行以内にありません`,
    };
  }

  const body = lines.slice(1, endIndex).join('\n');
  const yaml = parseYamlMapping(body);
  const data = yaml.mapping ? projectTopLevelScalars(yaml.mapping) : {};
  const noteMd = yaml.mapping ? parseNoteMdMarker(yaml.mapping) : recoverNoteMdMarker(body);

  const content = lines.slice(endIndex + 1).join('\n');
  const lineCount = endIndex + 1;
  return { data, content, lineCount, noteMd, frontmatterError: yaml.error };
}

/** Parse a bounded YAML mapping without aliases or duplicate keys. */
function parseYamlMapping(source: string): {
  mapping?: Map<unknown, unknown>;
  error?: string;
} {
  const genericError = 'frontmatter を安全な YAML として解析できません';
  if (Buffer.byteLength(source, 'utf8') > MAX_FRONTMATTER_BYTES) {
    return { error: `frontmatter が上限 ${MAX_FRONTMATTER_BYTES} bytes を超えています` };
  }

  try {
    const document = parseDocument(source, {
      schema: 'core',
      uniqueKeys: true,
    });
    if (document.errors.length > 0) return { error: genericError };
    const value: unknown = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
    return value instanceof Map ? { mapping: value } : { error: genericError };
  } catch {
    return { error: genericError };
  }
}

/** Preserve explicit note intent even when unrelated YAML is malformed. */
function recoverNoteMdMarker(source: string): NoteMdMarker {
  const marker = source.split('\n').find((line) => /^note-md\s*:/.test(line));
  if (!marker) return { hasMarker: false, optOut: false, config: {} };
  return { hasMarker: true, optOut: false, config: {} };
}

/** Project top-level scalar values while preserving the legacy `data` API. */
function projectTopLevelScalars(mapping: Map<unknown, unknown>): Frontmatter {
  const data: Frontmatter = {};
  for (const [key, value] of mapping) {
    if (typeof key !== 'string' || key.length === 0) continue;
    const scalar = scalarToString(value);
    if (scalar !== undefined) data[key] = scalar;
  }
  return data;
}

/** Locate and normalize the `note-md` marker from the decoded mapping. */
function parseNoteMdMarker(mapping: Map<unknown, unknown>): NoteMdMarker {
  if (!mapping.has('note-md')) {
    return { hasMarker: false, optOut: false, config: {} };
  }

  const marker = mapping.get('note-md');
  if (marker === false) return { hasMarker: true, optOut: true, config: {} };

  const config: NoteMdConfig = {};
  if (marker instanceof Map) {
    const eyecatch = marker.get('eyecatch');
    if (typeof eyecatch === 'string' && eyecatch.length > 0) {
      config.eyecatch = eyecatch;
    }

    const version = marker.get('version');
    const numericVersion =
      typeof version === 'number'
        ? version
        : typeof version === 'string' && version.trim() !== ''
          ? Number(version)
          : Number.NaN;
    if (Number.isFinite(numericVersion)) config.version = numericVersion;
  }

  // Any value other than boolean false opts the document in. Unknown fields
  // and unexpected scalar values are deliberately ignored.
  return { hasMarker: true, optOut: false, config };
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return '';
  return undefined;
}
