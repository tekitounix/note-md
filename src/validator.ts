import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { decodeHTML } from 'entities';
import {
  isExternalImageRef,
  normalizeImageRef,
  resolveLocalImageRef,
  resolveLocalImageRefAsync,
} from './imageRefs';
import { scanImageReferences, type MarkdownImageReference } from './imageScanner';
import { parseFrontmatter, NOTE_MD_SCHEMA_VERSION } from './frontmatter';

// ─── Interfaces ─────────────────────────────────────────────

export interface NoteDiagnostic {
  ruleId: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  range: {
    line: number; // 0-based
    column: number; // 0-based
    length: number;
  };
  fixes?: QuickFix[];
}

export interface QuickFix {
  title: string;
  edits: Array<{
    range: { line: number; column: number; length: number; endLine?: number; endColumn?: number };
    newText: string;
  }>;
}

interface ValidationRule {
  id: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  trigger: 'change' | 'save';
  check: (ctx: ValidationContext) => NoteDiagnostic[];
}

interface ValidationContext {
  text: string;
  lines: string[];
  isProtected: (line: number) => boolean;
  isIgnored: (line: number) => boolean;
  getExclusionZones: (line: number) => Array<[number, number]>;
  imageRefs: MarkdownImageReference[];
  articleDir?: string;
}

// ─── Preprocessing ──────────────────────────────────────────

function preprocess(lines: string[]): {
  protectedLines: boolean[];
  ignoredLines: Set<number>;
} {
  const protectedLines = new Array<boolean>(lines.length).fill(false);
  const ignoredLines = new Set<number>();

  // Pass 0: Frontmatter — protect lines within --- delimiters at file start
  if (lines.length > 0 && lines[0].trimEnd() === '---') {
    protectedLines[0] = true;
    for (let i = 1; i < lines.length && i <= 20; i++) {
      protectedLines[i] = true;
      if (lines[i].trimEnd() === '---') break;
    }
  }

  // Pass 1: Fenced code blocks (highest priority — processed before math)
  const codeBlockLines = new Set<number>();
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;
  let fenceStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fenceMatch) {
        inFence = true;
        fenceChar = fenceMatch[1][0];
        fenceLength = fenceMatch[1].length;
        fenceStart = i;
        protectedLines[i] = true;
        codeBlockLines.add(i);
      }
    } else {
      protectedLines[i] = true;
      codeBlockLines.add(i);
      const escapedFence = fenceChar === '`' ? '`' : '~';
      const closed = new RegExp(`^ {0,3}${escapedFence}{${fenceLength},}\\s*$`).test(line);
      if (closed) {
        inFence = false;
        fenceChar = '';
        fenceLength = 0;
        fenceStart = -1;
      }
    }
  }

  // Roll back unclosed fence (keep only the opening line protected)
  if (inFence && fenceStart >= 0) {
    for (let i = fenceStart + 1; i < lines.length; i++) {
      protectedLines[i] = false;
      codeBlockLines.delete(i);
    }
  }

  // Pass 2: Display math blocks + note-ignore (outside code blocks only)
  let inDisplayMath = false;
  let mathStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (protectedLines[i]) continue; // skip inside code blocks

    const line = lines[i];

    if (!inDisplayMath && /^\$\$\s*$/.test(line)) {
      inDisplayMath = true;
      mathStart = i;
      protectedLines[i] = true;
      continue;
    } else if (inDisplayMath) {
      protectedLines[i] = true;
      if (/^\$\$\s*$/.test(line)) {
        inDisplayMath = false;
        mathStart = -1;
      }
      continue;
    }

    // note-ignore comment
    if (/^\s*<!--\s*note-ignore-next-line\s*-->\s*$/.test(line)) {
      ignoredLines.add(i + 1);
    }
  }

  // Roll back unclosed math block (preserve code block protection)
  if (inDisplayMath && mathStart >= 0) {
    for (let i = mathStart + 1; i < lines.length; i++) {
      if (codeBlockLines.has(i)) continue;
      protectedLines[i] = false;
      // Re-check note-ignore on rolled-back lines
      if (/^\s*<!--\s*note-ignore-next-line\s*-->\s*$/.test(lines[i])) {
        ignoredLines.add(i + 1);
      }
    }
  }

  return { protectedLines, ignoredLines };
}

// ─── Exclusion zones ────────────────────────────────────────

function computeExclusionZones(line: string): Array<[number, number]> {
  const zones: Array<[number, number]> = [];

  // Inline code: `...`
  for (const m of line.matchAll(/`[^`]+`/g)) {
    zones.push([m.index!, m.index! + m[0].length]);
  }

  // Inline math: $${...}$$ (supports nested braces)
  for (const m of line.matchAll(/\$\$\{[\s\S]*?\}\$\$/g)) {
    zones.push([m.index!, m.index! + m[0].length]);
  }

  // Link URL: the url portion of [text](url)
  for (const m of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const urlStart = m.index! + m[0].indexOf('(') + 1;
    const urlEnd = urlStart + m[1].length;
    zones.push([urlStart, urlEnd]);
  }

  // HTML attribute values: attr="value"
  for (const m of line.matchAll(/\w+="[^"]*"/g)) {
    zones.push([m.index!, m.index! + m[0].length]);
  }

  // Bare URLs (auto-linked)
  for (const m of line.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
    zones.push([m.index!, m.index! + m[0].length]);
  }

  return zones;
}

function isInExclusionZone(zones: Array<[number, number]>, col: number, len: number): boolean {
  return zones.some(([s, e]) => col >= s && col + len <= e);
}

interface ImagePathMatch {
  value: string;
  pathStart: number;
  length: number;
}

function imagePathMatches(ctx: ValidationContext, line: number): ImagePathMatch[] {
  return ctx.imageRefs
    .filter((image) => image.line === line)
    .map((image) => ({
      value: image.sourceRef,
      pathStart: image.column,
      length: image.length,
    }));
}

function hasLocalPathEscape(imgPath: string): boolean {
  const slashNormalized = imgPath.replace(/\\/g, '/');
  return (
    slashNormalized.split('/').includes('..') ||
    path.isAbsolute(imgPath) ||
    /^[a-zA-Z]:[\\/]/.test(imgPath)
  );
}

function isOutsideArticleDir(articleDir: string | undefined, imgPath: string): boolean {
  if (isExternalImageRef(imgPath)) return false;
  if (!articleDir) return hasLocalPathEscape(imgPath);
  return resolveLocalImageRef(articleDir, imgPath) === null;
}

function normalizedImageExt(imgPath: string): string {
  return path.posix.extname(normalizeImageRef(imgPath)).replace(/^\./, '').toUpperCase();
}

// ─── Helpers ────────────────────────────────────────────────

function diag(
  rule: Pick<ValidationRule, 'id' | 'severity'>,
  message: string,
  line: number,
  column: number,
  length: number,
  fixes?: QuickFix[],
): NoteDiagnostic {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    message,
    range: { line, column, length },
    fixes,
  };
}

interface H1Match {
  line: number;
  column: number;
  length: number;
  setextUnderlineLine?: number;
  hasVisibleText: boolean;
}

function hasVisibleHeadingText(text: string): boolean {
  return (
    decodeHTML(text)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_~`]/g, '')
      .trim().length > 0
  );
}

function findH1Headings(ctx: ValidationContext): H1Match[] {
  const headings: H1Match[] = [];
  for (let i = 0; i < ctx.lines.length; i++) {
    if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
    const atx = ctx.lines[i].match(/^ {0,3}#(?:[ \t]+(.*)|$)/);
    if (atx) {
      const headingText = (atx[1] ?? '').replace(/[ \t]+#+[ \t]*$/, '');
      headings.push({
        line: i,
        column: 0,
        length: ctx.lines[i].length,
        hasVisibleText: hasVisibleHeadingText(headingText),
      });
      continue;
    }
    if (
      ctx.lines[i].trim() !== '' &&
      i + 1 < ctx.lines.length &&
      !ctx.isProtected(i + 1) &&
      !ctx.isIgnored(i + 1) &&
      /^ {0,3}=+\s*$/.test(ctx.lines[i + 1])
    ) {
      headings.push({
        line: i,
        column: 0,
        length: ctx.lines[i].length,
        setextUnderlineLine: i + 1,
        hasVisibleText: hasVisibleHeadingText(ctx.lines[i]),
      });
      i++;
    }
  }
  return headings;
}

// ─── Rule definitions ───────────────────────────────────────

// --- 4.1 Unsupported syntax detection ---

const rules: ValidationRule[] = [
  // note/no-table — Pipe tables
  {
    id: 'note/no-table',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length - 1; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        const next = ctx.lines[i + 1];
        const hasColumns = /(^|[^\\])\|/.test(line);
        const isDelimiter = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
        if (hasColumns && isDelimiter) {
          // Mark entire table block (header row)
          results.push(diag(this, 'テーブル記法は note.com では表示されません', i, 0, line.length));
        }
      }
      return results;
    },
  },

  // note/no-italic — Italic *text* _text_
  {
    id: 'note/no-italic',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        const zones = ctx.getExclusionZones(i);

        // *text* — excludes **bold**
        for (const m of line.matchAll(/(?<!\*)\*(?!\*|\s)([^*\n]+?)(?<!\s|\*)\*(?!\*)/g)) {
          if (!isInExclusionZone(zones, m.index!, m[0].length)) {
            results.push(
              diag(
                this,
                'イタリック記法 (*text*) は note.com では表示されません',
                i,
                m.index!,
                m[0].length,
                [
                  {
                    title: '太字に変換 (**text**)',
                    edits: [
                      {
                        range: { line: i, column: m.index!, length: m[0].length },
                        newText: `**${m[1]}**`,
                      },
                    ],
                  },
                ],
              ),
            );
          }
        }

        // _text_ — excludes __bold__
        for (const m of line.matchAll(/(?<!_)_(?!_|\s)([^_\n]+?)(?<!\s|_)_(?!_)/g)) {
          if (!isInExclusionZone(zones, m.index!, m[0].length)) {
            results.push(
              diag(
                this,
                'イタリック記法 (_text_) は note.com では表示されません',
                i,
                m.index!,
                m[0].length,
                [
                  {
                    title: '太字に変換 (**text**)',
                    edits: [
                      {
                        range: { line: i, column: m.index!, length: m[0].length },
                        newText: `**${m[1]}**`,
                      },
                    ],
                  },
                ],
              ),
            );
          }
        }
      }
      return results;
    },
  },

  // note/no-inline-code — Backtick `code`
  {
    id: 'note/no-inline-code',
    severity: 'info',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        for (const m of line.matchAll(/(?<!`)`([^`]+)`(?!`)/g)) {
          results.push(
            diag(
              this,
              'インラインコード記法は note.com では表示されません',
              i,
              m.index!,
              m[0].length,
              [
                {
                  title: 'バッククォートを除去',
                  edits: [
                    {
                      range: { line: i, column: m.index!, length: m[0].length },
                      newText: m[1],
                    },
                  ],
                },
              ],
            ),
          );
        }
      }
      return results;
    },
  },

  // note/no-h456 — h4–h6 headings
  {
    id: 'note/no-h456',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const m = ctx.lines[i].match(/^(#{4,6})\s/);
        if (m) {
          results.push(
            diag(this, `${m[1]} は note.com では見出しとして認識されません`, i, 0, m[1].length, [
              {
                title: 'h3 (###) に変換',
                edits: [
                  {
                    range: { line: i, column: 0, length: m[1].length },
                    newText: '###',
                  },
                ],
              },
            ]),
          );
        }
      }
      return results;
    },
  },

  // note/no-html5 — <details>, <summary>, <dl>, <dt>, <dd>
  {
    id: 'note/no-html5',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        for (const m of line.matchAll(/<\s*(details|summary|dl|dt|dd)\b/gi)) {
          results.push(
            diag(this, `<${m[1]}> は note.com では表示されません`, i, m.index!, m[0].length),
          );
        }
      }
      return results;
    },
  },

  // note/no-footnote — Footnotes [^1] / [^1]:
  {
    id: 'note/no-footnote',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        const zones = ctx.getExclusionZones(i);
        for (const m of line.matchAll(/\[\^[^\]]+\]/g)) {
          if (!isInExclusionZone(zones, m.index!, m[0].length)) {
            results.push(
              diag(this, '脚注記法は note.com では表示されません', i, m.index!, m[0].length),
            );
          }
        }
      }
      return results;
    },
  },

  // note/no-image-title — ![alt](url "title")
  {
    id: 'note/no-image-title',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      const seen = new Set<string>();
      for (const image of ctx.imageRefs) {
        const range = image.titleRange;
        if (!range || ctx.isProtected(range.line) || ctx.isIgnored(image.useRange.line)) continue;
        const key = `${range.line}:${range.column}:${range.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(
          diag(
            this,
            '画像の title 属性は note.com では無視されます',
            range.line,
            range.column,
            range.length,
            [
              {
                title: 'title 属性を除去',
                edits: [{ range, newText: '' }],
              },
            ],
          ),
        );
      }
      return results;
    },
  },

  // note/image-alt-empty — Images should explain their purpose to screen-reader users.
  {
    id: 'note/image-alt-empty',
    severity: 'hint',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (const image of ctx.imageRefs) {
        if (image.kind === 'frontmatter' || image.alt.trim() !== '') continue;
        if (ctx.isProtected(image.altRange.line) || ctx.isIgnored(image.altRange.line)) continue;
        results.push(
          diag(
            this,
            '画像の代替テキストを入力してください。装飾画像は note-ignore-next-line で明示できます',
            image.altRange.line,
            image.altRange.column,
            image.altRange.length,
          ),
        );
      }
      return results;
    },
  },

  // note/image-external-unverified — Remote URLs bypass the verified upload pipeline.
  {
    id: 'note/image-external-unverified',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      return ctx.imageRefs
        .filter(
          (image) =>
            isExternalImageRef(image.sourceRef) &&
            !ctx.isProtected(image.useRange.line) &&
            !ctx.isIgnored(image.useRange.line),
        )
        .map((image) =>
          diag(
            this,
            '外部画像は到達性・Content-Type・note.com からの取得可否を自動検証できません',
            image.line,
            image.column,
            image.length,
          ),
        );
    },
  },

  // --- 4.2 Custom extension validation ---

  // note/ruby-unmatched — Mismatched ruby open/close markers
  {
    id: 'note/ruby-unmatched',
    severity: 'error',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        const zones = ctx.getExclusionZones(i);

        // ｜ or | (fullwidth/halfwidth) without closing 《》
        for (const m of line.matchAll(/[｜|]([^《\n]+?)$/gm)) {
          if (!isInExclusionZone(zones, m.index!, m[0].length)) {
            // Exclude table rows (pipe used for different purpose)
            if (/^\|.*\|/.test(line)) continue;
            results.push(diag(this, 'ルビの閉じタグ《》がありません', i, m.index!, m[0].length));
          }
        }

        // 《》 without corresponding ｜, or empty ruby 《》
        for (const m of line.matchAll(/《([^》]*)》/g)) {
          // Detect empty ruby 《》
          if (m[1].trim() === '') {
            if (!isInExclusionZone(zones, m.index!, m[0].length)) {
              results.push(diag(this, 'ルビの内容が空です', i, m.index!, m[0].length));
            }
            continue;
          }
          // Check for valid pair: ｜ + text immediately before
          const before = line.slice(0, m.index!);
          if (!/[｜|][^｜|《》]+$/.test(before)) {
            if (!isInExclusionZone(zones, m.index!, m[0].length)) {
              results.push(
                diag(this, 'ルビの開始マーク（｜）がありません', i, m.index!, m[0].length),
              );
            }
          }
        }
      }
      return results;
    },
  },

  // note/ruby-nested — Nested ruby markers
  {
    id: 'note/ruby-nested',
    severity: 'error',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        const zones = ctx.getExclusionZones(i);
        // Ruby marker inside another ruby span
        for (const m of line.matchAll(/[｜|][^《》]*[｜|][^《》]*《[^》]*》/g)) {
          if (!isInExclusionZone(zones, m.index!, m[0].length)) {
            results.push(diag(this, 'ルビの入れ子は無効です', i, m.index!, m[0].length));
          }
        }
      }
      return results;
    },
  },

  // note/math-unmatched — Inline math delimiter mismatch $${...}$$
  {
    id: 'note/math-unmatched',
    severity: 'error',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];

        // Detect $${ without matching }$$
        for (const m of line.matchAll(/\$\$\{/g)) {
          // Check for matching closing }$$
          const rest = line.slice(m.index! + 3);
          if (!/\}\$\$/.test(rest)) {
            results.push(
              diag(this, 'インライン数式の閉じデリミタ }$$ がありません', i, m.index!, 3),
            );
          }
        }
      }
      return results;
    },
  },

  // note/math-display-unclosed — Unclosed display math block
  {
    id: 'note/math-display-unclosed',
    severity: 'error',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      let openLine = -1;

      for (let i = 0; i < ctx.lines.length; i++) {
        // This rule checks fence open/close even on protected lines
        const line = ctx.lines[i];
        if (ctx.isIgnored(i)) continue;

        if (openLine === -1 && /^\$\$\s*$/.test(line)) {
          openLine = i;
        } else if (openLine !== -1 && /^\$\$\s*$/.test(line)) {
          openLine = -1; // properly closed
        }
      }

      if (openLine !== -1) {
        results.push(diag(this, 'ディスプレイ数式 ($$) が閉じられていません', openLine, 0, 2));
      }

      return results;
    },
  },

  // --- 4.3 Image validation (save trigger) ---

  // note/image-path-traversal — Directory traversal via ../
  {
    id: 'note/image-path-traversal',
    severity: 'error',
    trigger: 'change', // Can be determined from the path string alone
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        for (const img of imagePathMatches(ctx, i)) {
          if (isOutsideArticleDir(ctx.articleDir, img.value)) {
            results.push(
              diag(
                this,
                '画像パスが記事ディレクトリの外を参照しています',
                i,
                img.pathStart,
                img.length,
              ),
            );
          }
        }
      }
      return results;
    },
  },

  // note/image-missing — Referenced file does not exist (save trigger)
  {
    id: 'note/image-missing',
    severity: 'error',
    trigger: 'save',
    check(ctx) {
      if (!ctx.articleDir) return [];
      const results: NoteDiagnostic[] = [];

      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        for (const img of imagePathMatches(ctx, i)) {
          if (isExternalImageRef(img.value)) continue;
          const resolved = resolveLocalImageRef(ctx.articleDir, img.value);
          if (!resolved) continue;
          if (!resolved.exists) {
            results.push(
              diag(
                this,
                `画像ファイルが見つかりません: ${img.value}`,
                i,
                img.pathStart,
                img.length,
              ),
            );
          }
        }
      }
      return results;
    },
  },

  // note/image-oversized — Exceeds 20 MB (save trigger)
  {
    id: 'note/image-oversized',
    severity: 'error',
    trigger: 'save',
    check(ctx) {
      if (!ctx.articleDir) return [];
      const results: NoteDiagnostic[] = [];
      const MAX_SIZE = 20 * 1024 * 1024;

      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        for (const img of imagePathMatches(ctx, i)) {
          if (isExternalImageRef(img.value)) continue;
          const resolved = resolveLocalImageRef(ctx.articleDir, img.value);
          if (!resolved?.exists) continue;
          try {
            const stat = fs.statSync(resolved.diskPath);
            if (stat.size > MAX_SIZE) {
              const mb = (stat.size / (1024 * 1024)).toFixed(1);
              results.push(
                diag(
                  this,
                  `画像ファイルが 20MB を超えています (${mb}MB)`,
                  i,
                  img.pathStart,
                  img.length,
                ),
              );
            }
          } catch {
            // file doesn't exist — handled by image-missing rule
          }
        }
      }
      return results;
    },
  },

  // note/image-unsupported — Formats auto-converted on upload (SVG, WebP, etc.)
  {
    id: 'note/image-unsupported',
    severity: 'info',
    trigger: 'save',
    check(ctx) {
      if (!ctx.articleDir) return [];
      const results: NoteDiagnostic[] = [];
      const autoConvert = /\.(svg|webp|tiff?|bmp)$/i;

      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        for (const img of imagePathMatches(ctx, i)) {
          if (isExternalImageRef(img.value)) continue;
          if (autoConvert.test(img.value)) {
            results.push(
              diag(
                this,
                `${normalizedImageExt(img.value)} 形式はアップロード時に自動変換されます`,
                i,
                img.pathStart,
                img.length,
              ),
            );
          }
        }
      }
      return results;
    },
  },

  // note/image-unconvertible — AVIF is not supported by the conversion pipeline.
  {
    id: 'note/image-unconvertible',
    severity: 'error',
    trigger: 'save',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        for (const img of imagePathMatches(ctx, i)) {
          if (!isExternalImageRef(img.value) && /\.avif$/i.test(img.value)) {
            results.push(
              diag(
                this,
                'AVIF は自動変換できません。PNG または JPEG に変換してください',
                i,
                img.pathStart,
                img.length,
              ),
            );
          }
        }
      }
      return results;
    },
  },

  // note/image-low-res — Under 620px width
  // Image metadata checks run in validateAsync() (async pipeline).

  // --- 4.4 Structural validation ---

  // note/missing-h1 — An article needs exactly one copyable title.
  {
    id: 'note/missing-h1',
    severity: 'error',
    trigger: 'change',
    check(ctx) {
      if (findH1Headings(ctx).length > 0) return [];
      return [diag(this, '記事タイトルとなる h1 見出しがありません', 0, 0, 0)];
    },
  },

  // note/empty-h1 — A syntactic h1 that produces no copyable title is invalid.
  {
    id: 'note/empty-h1',
    severity: 'error',
    trigger: 'change',
    check(ctx) {
      return findH1Headings(ctx)
        .filter((heading) => !heading.hasVisibleText)
        .map((heading) =>
          diag(this, 'h1 見出しのタイトルが空です', heading.line, heading.column, heading.length),
        );
    },
  },

  // note/multiple-h1 — More than one h1
  {
    id: 'note/multiple-h1',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      return findH1Headings(ctx)
        .slice(1)
        .map((heading) => {
          const edits: QuickFix['edits'] = heading.setextUnderlineLine
            ? [
                {
                  range: {
                    line: heading.setextUnderlineLine,
                    column: 0,
                    length: ctx.lines[heading.setextUnderlineLine].length,
                  },
                  newText: '---',
                },
              ]
            : [{ range: { line: heading.line, column: 0, length: 1 }, newText: '##' }];
          return diag(
            this,
            'h1 見出しが複数あります（note.com ではタイトルは別途入力します）',
            heading.line,
            heading.column,
            heading.length,
            [{ title: 'h2 (##) に変換', edits }],
          );
        });
    },
  },

  // note/hr-variant — HR variants like *** or ___
  {
    id: 'note/hr-variant',
    severity: 'hint',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];
        if (/^(\*{3,}|_{3,})\s*$/.test(line)) {
          results.push(
            diag(this, '区切り線は --- を使用してください', i, 0, line.trimEnd().length, [
              {
                title: '--- に変換',
                edits: [
                  {
                    range: { line: i, column: 0, length: line.trimEnd().length },
                    newText: '---',
                  },
                ],
              },
            ]),
          );
        }
      }
      return results;
    },
  },

  // note/unclosed-html-tag — HTML tag without closing tag
  {
    id: 'note/unclosed-html-tag',
    severity: 'warning',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      // Void elements (self-closing) are excluded
      const voidTags = new Set([
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'param',
        'source',
        'track',
        'wbr',
      ]);
      const tagStack: Array<{ tag: string; line: number; col: number; len: number }> = [];

      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        const line = ctx.lines[i];

        // Strip HTML comments before processing tags
        const lineNoComments = line.replace(/<!--[\s\S]*?-->/g, '');
        // Opening tags
        for (const m of lineNoComments.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*(?<!\/)>/g)) {
          const tag = m[1].toLowerCase();
          if (voidTags.has(tag)) continue;
          tagStack.push({ tag, line: i, col: m.index!, len: m[0].length });
        }

        // Closing tags
        for (const m of lineNoComments.matchAll(/<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/g)) {
          const tag = m[1].toLowerCase();
          // Find matching opening tag from the end of stack
          for (let j = tagStack.length - 1; j >= 0; j--) {
            if (tagStack[j].tag === tag) {
              tagStack.splice(j, 1);
              break;
            }
          }
        }
      }

      // Remaining stack entries = unclosed tags
      for (const entry of tagStack) {
        // Only report tags used for styling in note (p, div, span, etc.)
        // HTML5 elements are reported by a separate rule
        const html5Tags = new Set(['details', 'summary', 'dl', 'dt', 'dd']);
        if (html5Tags.has(entry.tag)) continue;
        results.push(
          diag(this, `<${entry.tag}> の閉じタグがありません`, entry.line, entry.col, entry.len),
        );
      }
      return results;
    },
  },

  // note/consecutive-blanks — 3 or more consecutive blank lines
  {
    id: 'note/consecutive-blanks',
    severity: 'hint',
    trigger: 'change',
    check(ctx) {
      const results: NoteDiagnostic[] = [];
      let blankCount = 0;
      let blankStart = -1;

      for (let i = 0; i < ctx.lines.length; i++) {
        if (/^\s*$/.test(ctx.lines[i])) {
          if (blankCount === 0) blankStart = i;
          blankCount++;
        } else {
          if (blankCount >= 3) {
            results.push(
              diag(
                this,
                `${blankCount} 行の連続空行があります（2行に削減してください）`,
                blankStart,
                0,
                0,
                [
                  {
                    title: '2行に削減',
                    edits: [
                      {
                        range: {
                          line: blankStart + 2,
                          column: 0,
                          length: 0,
                          endLine: i,
                          endColumn: 0,
                        },
                        newText: '',
                      },
                    ],
                  },
                ],
              ),
            );
          }
          blankCount = 0;
        }
      }

      // Trailing consecutive blank lines at end of file
      if (blankCount >= 3) {
        results.push(
          diag(
            this,
            `${blankCount} 行の連続空行があります（2行に削減してください）`,
            blankStart,
            0,
            0,
          ),
        );
      }

      return results;
    },
  },

  // note/unsupported-version — note-md header written for a newer schema version
  {
    id: 'note/unsupported-version',
    severity: 'info',
    trigger: 'change',
    check(ctx) {
      const { noteMd } = parseFrontmatter(ctx.text);
      if (!noteMd.hasMarker || noteMd.optOut) return [];
      const v = noteMd.config.version;
      if (v === undefined || v <= NOTE_MD_SCHEMA_VERSION) return [];
      // Anchor on the `version:` line if present, else the `note-md:` line.
      let line = 0;
      for (let i = 0; i < ctx.lines.length && i <= 100; i++) {
        if (i > 0 && ctx.lines[i].trimEnd() === '---') break;
        if (/^note-md\s*:/.test(ctx.lines[i])) line = i;
        if (/version\s*:/.test(ctx.lines[i])) {
          line = i;
          break;
        }
      }
      return [
        diag(
          this,
          `この記事は新しい note-md 形式 (version ${v}) で書かれています。拡張を更新してください`,
          line,
          0,
          (ctx.lines[line] ?? '').length,
        ),
      ];
    },
  },
];

// ─── Public API ─────────────────────────────────────────────

/** Run validation on the given text. */
export function validate(
  text: string,
  trigger: 'change' | 'save',
  articleDir?: string,
  disabledRules?: string[],
): NoteDiagnostic[] {
  const lines = text.split('\n');
  const { protectedLines, ignoredLines } = preprocess(lines);
  const disabled = new Set(disabledRules ?? []);

  const zoneCache = new Map<number, Array<[number, number]>>();

  const ctx: ValidationContext = {
    text,
    lines,
    isProtected: (line) => protectedLines[line] ?? false,
    isIgnored: (line) => ignoredLines.has(line),
    getExclusionZones: (line) => {
      if (!zoneCache.has(line)) {
        zoneCache.set(line, computeExclusionZones(lines[line] ?? ''));
      }
      return zoneCache.get(line)!;
    },
    imageRefs: scanImageReferences(text),
    articleDir,
  };

  const results: NoteDiagnostic[] = [];
  for (const rule of rules) {
    if (disabled.has(rule.id)) continue;
    if (trigger === 'change' && rule.trigger === 'save') continue;
    results.push(...rule.check(ctx));
  }
  return results;
}

// ─── Async validation (save-trigger I/O rules) ─────────────

interface AsyncValidationRule {
  id: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  check: (ctx: ValidationContext) => Promise<NoteDiagnostic[]>;
}

const asyncRules: AsyncValidationRule[] = [
  // note/image-missing — async version using fs.promises
  {
    id: 'note/image-missing',
    severity: 'error',
    async check(ctx) {
      if (!ctx.articleDir) return [];
      const results: NoteDiagnostic[] = [];

      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        for (const img of imagePathMatches(ctx, i)) {
          if (isExternalImageRef(img.value)) continue;
          const resolved = await resolveLocalImageRefAsync(ctx.articleDir, img.value);
          if (!resolved) continue;
          if (!resolved.exists) {
            results.push(
              diag(
                this,
                `画像ファイルが見つかりません: ${img.value}`,
                i,
                img.pathStart,
                img.length,
              ),
            );
          }
        }
      }
      return results;
    },
  },

  // note/image-oversized — async version using fs.promises
  {
    id: 'note/image-oversized',
    severity: 'error',
    async check(ctx) {
      if (!ctx.articleDir) return [];
      const results: NoteDiagnostic[] = [];
      const MAX_SIZE = 20 * 1024 * 1024;

      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.isProtected(i) || ctx.isIgnored(i)) continue;
        for (const img of imagePathMatches(ctx, i)) {
          if (isExternalImageRef(img.value)) continue;
          const resolved = await resolveLocalImageRefAsync(ctx.articleDir, img.value);
          if (!resolved?.exists) continue;
          try {
            const stat = await fsp.stat(resolved.diskPath);
            if (stat.size > MAX_SIZE) {
              const mb = (stat.size / (1024 * 1024)).toFixed(1);
              results.push(
                diag(
                  this,
                  `画像ファイルが 20MB を超えています (${mb}MB)`,
                  i,
                  img.pathStart,
                  img.length,
                ),
              );
            }
          } catch {
            // file doesn't exist — handled by image-missing rule
          }
        }
      }
      return results;
    },
  },
];

/** IDs of rules that have async replacements */
const asyncRuleIds = new Set(asyncRules.map((r) => r.id));

/** Stable rule IDs exposed to configuration UIs and the CLI. */
export const RULE_IDS = Object.freeze([
  ...new Set([...rules, ...asyncRules].map((rule) => rule.id)),
]);

/**
 * Async validation — runs all sync rules plus async I/O-bound rules.
 * Use this for save-trigger validation to avoid blocking the event loop.
 * The caller should compare doc.version before applying results.
 */
export async function validateAsync(
  text: string,
  articleDir?: string,
  disabledRules?: string[],
): Promise<NoteDiagnostic[]> {
  const lines = text.split('\n');
  const { protectedLines, ignoredLines } = preprocess(lines);
  const disabled = new Set(disabledRules ?? []);

  const zoneCache = new Map<number, Array<[number, number]>>();

  const ctx: ValidationContext = {
    text,
    lines,
    isProtected: (line) => protectedLines[line] ?? false,
    isIgnored: (line) => ignoredLines.has(line),
    getExclusionZones: (line) => {
      if (!zoneCache.has(line)) {
        zoneCache.set(line, computeExclusionZones(lines[line] ?? ''));
      }
      return zoneCache.get(line)!;
    },
    imageRefs: scanImageReferences(text),
    articleDir,
  };

  // Run sync rules (skip those replaced by async versions)
  const results: NoteDiagnostic[] = [];
  for (const rule of rules) {
    if (disabled.has(rule.id)) continue;
    if (asyncRuleIds.has(rule.id)) continue;
    results.push(...rule.check(ctx));
  }

  // Run async rules
  for (const rule of asyncRules) {
    if (disabled.has(rule.id)) continue;
    results.push(...(await rule.check(ctx)));
  }

  return results;
}
