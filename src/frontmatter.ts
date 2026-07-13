/**
 * Parse YAML-style frontmatter from a Markdown document.
 *
 * The parser is intentionally small: it is NOT a general YAML implementation.
 * It extracts two things the extension actually needs:
 *   1. top-level flat `key: value` pairs (for the legacy `header` eyecatch), and
 *   2. the `note-md` marker that opts a file in as a note article, plus its
 *      optional scalar fields (`eyecatch`, `version`).
 * Every other tool's frontmatter keys are ignored.
 *
 * Recognition contract (see plans/audits/note-header-schema/proposal.md):
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
}

/** Maximum number of lines scanned while looking for the closing `---` fence. */
const MAX_FRONTMATTER_LINES = 100;

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
    return { data: {}, content: markdown, lineCount: 0, noteMd: EMPTY_MARKER };
  }

  const body = lines.slice(1, endIndex);
  const data = parseTopLevelFlat(body);
  const noteMd = parseNoteMdMarker(body);

  const content = lines.slice(endIndex + 1).join('\n');
  const lineCount = endIndex + 1;
  return { data, content, lineCount, noteMd };
}

/** Parse only column-0 `key: value` pairs (nested/indented lines are ignored). */
function parseTopLevelFlat(body: string[]): Frontmatter {
  const data: Frontmatter = {};
  for (const line of body) {
    if (/^\s/.test(line)) continue; // skip indented (nested) lines
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    data[key] = stripScalar(line.slice(colonIdx + 1));
  }
  return data;
}

/** Locate and parse the `note-md` marker within the frontmatter body lines. */
function parseNoteMdMarker(body: string[]): NoteMdMarker {
  let markerIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (/^note-md\s*:/.test(body[i])) {
      markerIdx = i;
      break;
    }
  }
  if (markerIdx < 0) return { hasMarker: false, optOut: false, config: {} };

  const line = body[markerIdx];
  const rest = stripComment(line.slice(line.indexOf(':') + 1)).trim();

  // Explicit opt-out
  if (rest === 'false') return { hasMarker: true, optOut: true, config: {} };

  // Flow-style mapping: note-md: { eyecatch: a.png, version: 1 }
  if (rest.startsWith('{')) {
    return { hasMarker: true, optOut: false, config: parseFlowMapping(rest) };
  }

  // Scalar truthy marker (true / null / ~ / empty) or block-style mapping.
  const config: NoteMdConfig = {};
  if (rest === '' || rest === '~' || rest === 'null' || rest === 'true') {
    // Block-style: collect indented child lines following the marker.
    for (let i = markerIdx + 1; i < body.length; i++) {
      if (!/^\s/.test(body[i])) break; // dedent -> end of block
      if (body[i].trim() === '') continue;
      assignNoteMdField(config, body[i]);
    }
  }
  // Any other scalar (e.g. a stray string) still counts as an opt-in marker.
  return { hasMarker: true, optOut: false, config };
}

/** Parse a flow mapping body like `{ eyecatch: a.png, version: 1 }`. */
function parseFlowMapping(rest: string): NoteMdConfig {
  const config: NoteMdConfig = {};
  const inner = rest.replace(/^\{/, '').replace(/\}\s*$/, '');
  for (const part of inner.split(',')) {
    if (part.trim() !== '') assignNoteMdField(config, part);
  }
  return config;
}

/** Assign a single `key: value` fragment to the note-md config. */
function assignNoteMdField(config: NoteMdConfig, fragment: string): void {
  const colonIdx = fragment.indexOf(':');
  if (colonIdx < 0) return;
  const key = fragment.slice(0, colonIdx).trim();
  const value = stripScalar(fragment.slice(colonIdx + 1));
  if (key === 'eyecatch') {
    if (value) config.eyecatch = value;
  } else if (key === 'version') {
    const n = Number(value);
    if (Number.isFinite(n)) config.version = n;
  }
}

/** Strip a trailing ` # comment` from an (unquoted) value. */
function stripComment(value: string): string {
  const trimmed = value.replace(/\r$/, '');
  const hashIdx = trimmed.search(/\s#/);
  return hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
}

/** Trim, unquote, and drop trailing comments from a scalar value. */
function stripScalar(value: string): string {
  let v = value.replace(/\r$/, '').trim();
  const quote = v[0];
  if (quote === '"' || quote === "'") {
    const end = v.indexOf(quote, 1);
    if (end > 0) return v.slice(1, end); // quoted content; any trailing comment ignored
  }
  const hashIdx = v.search(/\s#/);
  if (hashIdx >= 0) v = v.slice(0, hashIdx).trim();
  return v;
}
