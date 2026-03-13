/**
 * Parse YAML-style frontmatter from a Markdown document.
 *
 * Supports the standard `---` delimited block at the very beginning of the file.
 * Only simple key-value pairs are supported (no nested objects or arrays).
 *
 * Example:
 * ```markdown
 * ---
 * header: figures/header.png
 * ---
 *
 * # Article title
 * ```
 */

export interface Frontmatter {
  /** Header image path (relative to the article file) */
  header?: string;
  /** Raw key-value pairs from frontmatter */
  [key: string]: string | undefined;
}

export interface ParseResult {
  /** Parsed frontmatter values (empty object if no frontmatter) */
  data: Frontmatter;
  /** Markdown content with frontmatter stripped */
  content: string;
  /** Number of lines occupied by frontmatter (including delimiters), 0 if none */
  lineCount: number;
}

/**
 * Parse frontmatter from the beginning of a Markdown string.
 * Returns the parsed key-value pairs and the remaining content.
 */
export function parseFrontmatter(markdown: string): ParseResult {
  // Must start with "---" on the very first line
  if (!markdown.startsWith('---')) {
    return { data: {}, content: markdown, lineCount: 0 };
  }

  const lines = markdown.split('\n');
  // Find closing "---"
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---') {
      endIndex = i;
      break;
    }
    // Guard: stop if we've gone too far without finding closing delimiter
    if (i > 20) break;
  }

  if (endIndex < 0) {
    // No closing delimiter found — treat entire content as markdown
    return { data: {}, content: markdown, lineCount: 0 };
  }

  // Parse key: value pairs
  const data: Frontmatter = {};
  for (let i = 1; i < endIndex; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) data[key] = value;
  }

  // Strip frontmatter from content (preserve blank line after closing delimiter)
  const content = lines
    .slice(endIndex + 1)
    .join('\n')
    .replace(/^\n/, '');
  const lineCount = endIndex + 1;

  return { data, content, lineCount };
}
