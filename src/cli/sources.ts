import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { collectFiles, displayPath, readStream, SOURCE_FORMATS } from './files';
import { CliOptions, CliRuntime, CliSource } from './types';
import { errorMessage, isRecord } from './utils';

async function readCorpusSources(corpusPaths: string[]): Promise<CliSource[]> {
  const sources: CliSource[] = [];
  for (const corpusPath of corpusPaths) {
    const files = await collectFiles(corpusPath, new Set(['.json']), 'corpus');
    for (const filePath of files) {
      let corpus: unknown;
      try {
        corpus = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      } catch (error) {
        throw new Error(`Could not parse corpus file '${filePath}': ${errorMessage(error)}`);
      }
      if (!isRecord(corpus) || !Array.isArray(corpus.results)) {
        throw new Error(`Corpus file '${filePath}' must contain a results array.`);
      }

      for (const [index, result] of corpus.results.entries()) {
        if (!isRecord(result) || typeof result.query !== 'string') {
          throw new Error(`Corpus record results[${index}] in '${filePath}' must contain a query string.`);
        }
        sources.push({
          label: displayPath(filePath),
          filePath,
          text: result.query,
          format: 'ppl',
          keyPath: `results.${index}.query`,
          ...(typeof result.id === 'string' ? { corpusId: result.id } : {}),
          ...(typeof result.family === 'string' ? { family: result.family } : {}),
        });
      }
    }
  }
  return sources;
}

export async function readInputSources(
  options: CliOptions,
  runtime: CliRuntime,
  stdinImplicit: boolean,
  standaloneExtensions: readonly string[]
): Promise<CliSource[]> {
  const sourceFormats = new Map(SOURCE_FORMATS);
  for (const extension of standaloneExtensions) {
    const normalized = extension.startsWith('.') ? extension : `.${extension}`;
    sourceFormats.set(normalized.toLowerCase(), 'ppl');
  }
  const sources: CliSource[] = options.queries.map((text, index) => ({
    label: `<query ${index + 1}>`,
    text,
    format: 'ppl',
  }));
  sources.push(...await readCorpusSources(options.corpusPaths));
  const inputPaths = stdinImplicit ? ['-', ...options.paths] : options.paths;
  let stdinRead = false;

  for (const input of inputPaths) {
    if (input === '-') {
      if (stdinRead) throw new Error('Stdin may only be specified once.');
      if (!runtime.stdin) throw new Error('No stdin stream is available.');
      sources.push({ label: '<stdin>', text: await readStream(runtime.stdin), format: options.inputFormat });
      stdinRead = true;
      continue;
    }

    const files = await collectFiles(input, new Set(sourceFormats.keys()), 'input');
    for (const filePath of files) {
      const text = await readFile(filePath, 'utf8');
      const format = sourceFormats.get(path.extname(filePath).toLowerCase());
      if (!format) continue;
      sources.push({ label: displayPath(filePath), filePath, text, format });
    }
  }
  return sources;
}
