import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { minimatch } from 'minimatch';

export function absoluteGlobParts(glob: string): { base: string; pattern: string } {
  const wildcard = glob.search(/[*?{\[]/);
  const separator = wildcard < 0 ? glob.lastIndexOf(path.sep) : glob.lastIndexOf(path.sep, wildcard);
  return {
    base: glob.slice(0, separator) || path.parse(glob).root,
    pattern: glob.slice(separator + 1),
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