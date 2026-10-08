import { Buffer } from 'node:buffer';
import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { findAbsoluteFiles } from '../vscode/templateFiles';
import { InputFormat } from './types';
import { errorMessage } from './utils';

export const SOURCE_FORMATS = new Map<string, InputFormat>([
  ['.ppl', 'ppl'],
  ['.pplquery', 'ppl'],
  ['.query', 'ppl'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml'],
  ['.json', 'json'],
]);
export const TEMPLATE_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out', 'coverage']);

export async function readStream(stream: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  }
  return chunks.join('');
}

export async function collectFiles(
  input: string,
  extensions: ReadonlySet<string>,
  description: string
): Promise<string[]> {
  const absolutePath = path.resolve(input);
  let details;
  try {
    details = await stat(absolutePath);
  } catch (error) {
    throw new Error(`Could not access ${description} '${input}': ${errorMessage(error)}`);
  }

  if (details.isFile()) {
    const extension = path.extname(absolutePath).toLowerCase();
    if (!extensions.has(extension)) {
      throw new Error(`Unsupported ${description} file type '${extension || path.basename(absolutePath)}'.`);
    }
    return [absolutePath];
  }
  if (!details.isDirectory()) throw new Error(`'${input}' is not a file or directory.`);

  const matches: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(entryPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        matches.push(entryPath);
      }
    }
  }
  await visit(absolutePath);
  return matches.sort();
}

export async function collectTemplateFiles(input: string): Promise<string[]> {
  if (input.includes('*') || input.includes('?') || input.includes('{') || input.includes('[')) {
    return (await findAbsoluteFiles(path.resolve(input)))
      .filter((filePath) => TEMPLATE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  }
  return collectFiles(input, TEMPLATE_EXTENSIONS, 'template');
}

export function displayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath) || path.basename(filePath);
}
