import esbuild from 'esbuild';
import { chmod } from 'node:fs/promises';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

const makeExecutablePlugin = {
  name: 'make-executable',
  setup(build) {
    build.onEnd(async () => {
      try {
        await chmod('dist/cli.js', 0o755);
      } catch {
        // file might not exist or system does not support chmod
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  bundle: true,
  outdir: 'dist',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  mainFields: ['module', 'main'],
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info',
};

// The extension runs inside VS Code's bundled Node (18 for VS Code 1.85), so it keeps the old target.
// Only the standalone CLI, which bundles commander, requires Node 22.12.
/** @type {import('esbuild').BuildOptions[]} */
const buildConfigs = [
  { ...sharedOptions, entryPoints: { extension: 'src/extension.ts' }, target: 'node18' },
  {
    ...sharedOptions,
    entryPoints: { cli: 'src/cliMain.ts' },
    target: 'node22',
    plugins: [makeExecutablePlugin],
  },
];

try {
  if (isWatch) {
    for (const config of buildConfigs) {
      const ctx = await esbuild.context(config);
      await ctx.watch();
    }
    console.log('Watching for changes...');
  } else {
    await Promise.all(buildConfigs.map((config) => esbuild.build(config)));
    await chmod('dist/cli.js', 0o755).catch(() => {});
    console.log('Build completed successfully.');
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
