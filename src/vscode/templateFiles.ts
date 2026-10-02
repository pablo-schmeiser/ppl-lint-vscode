import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { minimatch } from 'minimatch';

export function absoluteGlobParts(glob: string): { base: string; pattern: string } {
  const windowsPath = path.sep === '\\' || /^[A-Za-z]:[\\/]/.test(glob) || glob.startsWith('\\\\');
  const pathApi = windowsPath ? path.win32 : path;
  const normalizedGlob = windowsPath ? glob.replaceAll('/', '\\') : glob;
  const wildcard = normalizedGlob.search(/[*?{\[]/);
  const separator = wildcard < 0
    ? normalizedGlob.lastIndexOf(pathApi.sep)
    : normalizedGlob.lastIndexOf(pathApi.sep, wildcard);
  const root = pathApi.parse(normalizedGlob).root;
  return {
    base: separator < root.length ? root : normalizedGlob.slice(0, separator),
    pattern: normalizedGlob.slice(separator + 1).split(pathApi.sep).join('/'),
  };
}

export async function findAbsoluteFiles(glob: string): Promise<string[]> {
  const { base, pattern } = absoluteGlobParts(glob);
  const matches: string[] = [];
  const nested = pattern.includes('/');

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (nested) await visit(fullPath);
      } else if (entry.isFile() && minimatch(path.relative(base, fullPath).split(path.sep).join('/'), pattern, {
        dot: true,
        nonegate: true,
        nocomment: true,
      })) {
        matches.push(fullPath);
      }
    }
  }

  await visit(base);
  return matches;
}
