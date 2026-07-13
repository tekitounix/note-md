import * as esbuild from 'esbuild';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import path from 'node:path';
import { generateThirdPartyLicenses } from './scripts/generate-third-party-licenses.mjs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionBuildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  metafile: true,
};

/** @type {import('esbuild').BuildOptions} */
const cliBuildOptions = {
  entryPoints: ['src/cli.ts'],
  bundle: true,
  outfile: 'dist/cli.js',
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  metafile: true,
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuildOptions = {
  entryPoints: ['src/webviewVendor.ts'],
  bundle: true,
  outfile: 'dist/webview-vendor.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  metafile: true,
};

/** @type {import('esbuild').BuildOptions} */
const mermaidBuildOptions = {
  entryPoints: ['src/webviewMermaid.ts'],
  bundle: true,
  outfile: 'dist/webview-mermaid.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  metafile: true,
};

/** Copy WASM assets that cannot be bundled by esbuild. */
function copyWasmAssets(outputDir = 'dist') {
  mkdirSync(outputDir, { recursive: true });
  const assets = [
    ['node_modules/@resvg/resvg-wasm/index_bg.wasm', 'resvg.wasm'],
    ['node_modules/@jsquash/webp/codec/dec/webp_dec.wasm', 'webp_dec.wasm'],
  ];
  for (const [src, fileName] of assets) {
    const dest = path.join(outputDir, fileName);
    try {
      copyFileSync(src, dest);
    } catch (e) {
      console.warn(`Warning: could not copy ${src}:`, e.message);
    }
  }

  copyFileSync(
    'node_modules/highlight.js/styles/atom-one-dark.min.css',
    path.join(outputDir, 'highlight.css'),
  );
  copyFileSync('node_modules/katex/dist/katex.min.css', path.join(outputDir, 'katex.css'));
  cpSync('node_modules/katex/dist/fonts', path.join(outputDir, 'fonts'), { recursive: true });
  chmodSync(path.join(outputDir, 'cli.js'), 0o755);
}

function optionsForOutputDir(options, outputDir) {
  return { ...options, outfile: path.join(outputDir, path.basename(options.outfile)) };
}

function replaceDistAtomically(buildDir) {
  const backupDir = `.dist-backup-${process.pid}`;
  rmSync(backupDir, { recursive: true, force: true });
  const hadPreviousDist = existsSync('dist');
  if (hadPreviousDist) renameSync('dist', backupDir);
  try {
    renameSync(buildDir, 'dist');
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    rmSync('dist', { recursive: true, force: true });
    if (hadPreviousDist && existsSync(backupDir)) renameSync(backupDir, 'dist');
    throw error;
  }
}

if (watch) {
  rmSync('dist', { recursive: true, force: true });
  const contexts = await Promise.all(
    [extensionBuildOptions, cliBuildOptions, webviewBuildOptions, mermaidBuildOptions].map(
      (options) => esbuild.context(options),
    ),
  );
  await Promise.all(contexts.map((context) => context.watch()));
  copyWasmAssets();
  console.log('Watching for changes...');
} else {
  const buildDir = `.dist-build-${process.pid}`;
  rmSync(buildDir, { recursive: true, force: true });
  const buildOptions = [
    extensionBuildOptions,
    cliBuildOptions,
    webviewBuildOptions,
    mermaidBuildOptions,
  ].map((options) => optionsForOutputDir(options, buildDir));

  let results;
  try {
    results = await Promise.all(buildOptions.map((options) => esbuild.build(options)));
    copyWasmAssets(buildDir);
    generateThirdPartyLicenses(
      results.flatMap((result) => Object.keys(result.metafile.inputs)),
      [
        'node_modules/@resvg/resvg-wasm',
        'node_modules/@jsquash/webp',
        'node_modules/highlight.js',
        'node_modules/katex',
      ],
    );
    replaceDistAtomically(buildDir);
  } catch (error) {
    rmSync(buildDir, { recursive: true, force: true });
    throw error;
  }
}
