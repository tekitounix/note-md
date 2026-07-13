import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULE_IDS, validateAsync, type NoteDiagnostic } from './validator';

type OutputFormat = 'text' | 'json' | 'sarif';

interface CheckTarget {
  file: string;
  diagnostics: NoteDiagnostic[];
}

interface CheckOptions {
  format: OutputFormat;
  stdin: boolean;
  articleDir?: string;
  disabledRules: string[];
  maxWarnings: number;
  files: string[];
}

const USAGE = `使い方:
  note-md check [options] <file...>
  note-md check --stdin [--article-dir <dir>]
  note-md rules

options:
  --format <text|json|sarif>  出力形式（既定: text）
  --stdin                     標準入力を検査
  --article-dir <dir>         標準入力の画像パス基準ディレクトリ
  --disable <rule[,rule...]>  ルールを無効化（複数指定可）
  --max-warnings <n>          許容する warning 数（既定: 無制限）
  --strict                    --max-warnings 0 の短縮形
  --help                      このヘルプを表示`;

function parseCheckOptions(args: string[]): CheckOptions {
  const options: CheckOptions = {
    format: 'text',
    stdin: false,
    disabledRules: [],
    maxWarnings: -1,
    files: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stdin') {
      options.stdin = true;
    } else if (arg === '--strict') {
      options.maxWarnings = 0;
    } else if (arg === '--format') {
      const value = args[++i] as OutputFormat | undefined;
      if (!value || !['text', 'json', 'sarif'].includes(value)) {
        throw new Error('--format には text、json、sarif のいずれかを指定してください');
      }
      options.format = value;
    } else if (arg === '--article-dir') {
      const value = args[++i];
      if (!value) throw new Error('--article-dir にはディレクトリを指定してください');
      options.articleDir = path.resolve(value);
    } else if (arg === '--disable') {
      const value = args[++i];
      if (!value) throw new Error('--disable にはルール ID を指定してください');
      options.disabledRules.push(...value.split(',').filter(Boolean));
    } else if (arg === '--max-warnings') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error('--max-warnings には 0 以上の整数を指定してください');
      }
      options.maxWarnings = Number(value);
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 0;
      return options;
    } else if (arg.startsWith('-')) {
      throw new Error(`不明なオプションです: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }

  const unknownRules = options.disabledRules.filter((id) => !RULE_IDS.includes(id));
  if (unknownRules.length > 0) {
    throw new Error(`不明なルール ID です: ${unknownRules.join(', ')}`);
  }
  if (!options.stdin && options.files.length === 0) {
    throw new Error('検査するファイル、または --stdin を指定してください');
  }
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function formatText(targets: CheckTarget[]): string {
  const lines: string[] = [];
  for (const target of targets) {
    for (const diagnostic of target.diagnostics) {
      const { line, column } = diagnostic.range;
      lines.push(
        `${target.file}:${line + 1}:${column + 1}: ${diagnostic.severity} ${diagnostic.message} [${diagnostic.ruleId}]`,
      );
    }
  }
  const count = targets.reduce((sum, target) => sum + target.diagnostics.length, 0);
  if (count === 0) return 'note-md: 問題は見つかりませんでした';
  return lines.join('\n');
}

function formatSarif(targets: CheckTarget[]): object {
  const usedRuleIds = [
    ...new Set(targets.flatMap((target) => target.diagnostics.map((d) => d.ruleId))),
  ];
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        originalUriBaseIds: {
          '%SRCROOT%': { uri: pathToFileURL(`${process.cwd()}${path.sep}`).href },
        },
        tool: {
          driver: {
            name: 'note-md',
            informationUri: 'https://github.com/tekitounix/note-md',
            rules: usedRuleIds.map((id) => ({ id })),
          },
        },
        results: targets.flatMap((target) =>
          target.diagnostics.map((diagnostic) => ({
            ruleId: diagnostic.ruleId,
            level:
              diagnostic.severity === 'error'
                ? 'error'
                : diagnostic.severity === 'warning'
                  ? 'warning'
                  : 'note',
            message: { text: diagnostic.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: sarifArtifactLocation(target.file),
                  region: {
                    startLine: diagnostic.range.line + 1,
                    startColumn: diagnostic.range.column + 1,
                    endColumn: diagnostic.range.column + diagnostic.range.length + 1,
                  },
                },
              },
            ],
          })),
        ),
      },
    ],
  };
}

function sarifArtifactLocation(file: string): { uri: string; uriBaseId?: string } {
  if (file === '<stdin>') return { uri: 'stdin.md', uriBaseId: '%SRCROOT%' };
  const absolute = path.resolve(file);
  const relative = path.relative(process.cwd(), absolute);
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return {
      uri: relative.split(path.sep).map(encodeURIComponent).join('/'),
      uriBaseId: '%SRCROOT%',
    };
  }
  return { uri: pathToFileURL(absolute).href };
}

async function check(args: string[]): Promise<number> {
  const options = parseCheckOptions(args);
  if (args.includes('--help') || args.includes('-h')) return 0;

  const targets: CheckTarget[] = [];
  if (options.stdin) {
    const text = await readStdin();
    targets.push({
      file: '<stdin>',
      diagnostics: await validateAsync(text, options.articleDir, options.disabledRules),
    });
  }
  for (const fileArg of options.files) {
    const file = path.resolve(fileArg);
    const text = await fs.readFile(file, 'utf8');
    targets.push({
      file,
      diagnostics: await validateAsync(text, path.dirname(file), options.disabledRules),
    });
  }

  if (options.format === 'text') {
    process.stdout.write(`${formatText(targets)}\n`);
  } else {
    const output = options.format === 'sarif' ? formatSarif(targets) : targets;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }

  const diagnostics = targets.flatMap((target) => target.diagnostics);
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  return hasErrors || (options.maxWarnings >= 0 && warningCount > options.maxWarnings) ? 1 : 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const command = args[0];
  if (command === 'rules') {
    process.stdout.write(`${RULE_IDS.join('\n')}\n`);
    return 0;
  }
  if (command === 'check') return check(args.slice(1));
  if (command === '--help' || command === '-h' || command === undefined) {
    process.stdout.write(`${USAGE}\n`);
    return command === undefined ? 2 : 0;
  }
  throw new Error(`不明なコマンドです: ${command}`);
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`note-md: ${message}\n`);
    process.exitCode = 2;
  });
