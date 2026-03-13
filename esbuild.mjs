import * as esbuild from 'esbuild';
import { copyFileSync } from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
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
};

/** Copy WASM assets that cannot be bundled by esbuild. */
function copyWasmAssets() {
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
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  copyWasmAssets();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  copyWasmAssets();
}
