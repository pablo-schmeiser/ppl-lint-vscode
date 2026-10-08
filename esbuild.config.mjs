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
const buildOptions = {
  entryPoints: {
    extension: 'src/extension.ts',
    cli: 'src/cliMain.ts',
  },
  bundle: true,
  outdir: 'dist',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  mainFields: ['module', 'main'],
  target: 'node18',
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info',
  plugins: [makeExecutablePlugin],
};

try {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    await chmod('dist/cli.js', 0o755).catch(() => {});
    console.log('Build completed successfully.');
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
