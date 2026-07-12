import * as esbuild from 'esbuild';
import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync } from 'fs';
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
function copyWasmAssets() {
  mkdirSync('dist', { recursive: true });
  const assets = [
    ['node_modules/@resvg/resvg-wasm/index_bg.wasm', 'dist/resvg.wasm'],
    ['node_modules/@jsquash/webp/codec/dec/webp_dec.wasm', 'dist/webp_dec.wasm'],
  ];
  for (const [src, dest] of assets) {
    try {
      copyFileSync(src, dest);
    } catch (e) {
      console.warn(`Warning: could not copy ${src}:`, e.message);
    }
  }

  copyFileSync('node_modules/highlight.js/styles/atom-one-dark.min.css', 'dist/highlight.css');
  copyFileSync('node_modules/katex/dist/katex.min.css', 'dist/katex.css');
  cpSync('node_modules/katex/dist/fonts', 'dist/fonts', { recursive: true });
  chmodSync('dist/cli.js', 0o755);
}

rmSync('dist', { recursive: true, force: true });

if (watch) {
  const contexts = await Promise.all(
    [extensionBuildOptions, cliBuildOptions, webviewBuildOptions, mermaidBuildOptions].map(
      (options) => esbuild.context(options),
    ),
  );
  await Promise.all(contexts.map((context) => context.watch()));
  copyWasmAssets();
  console.log('Watching for changes...');
} else {
  const results = await Promise.all([
    esbuild.build(extensionBuildOptions),
    esbuild.build(cliBuildOptions),
    esbuild.build(webviewBuildOptions),
    esbuild.build(mermaidBuildOptions),
  ]);
  copyWasmAssets();
  generateThirdPartyLicenses(
    results.flatMap((result) => Object.keys(result.metafile.inputs)),
    [
      'node_modules/@resvg/resvg-wasm',
      'node_modules/@jsquash/webp',
      'node_modules/highlight.js',
      'node_modules/katex',
    ],
  );
}
