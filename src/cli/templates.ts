import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  IndexTemplate,
  parseIndexTemplates,
  parseOpenSearchIndexMappings,
  parseOpenSearchIndexTemplates,
} from '../core/indexTemplates';
import {
  OpenSearchFetchOptions,
  OpenSearchFetcher,
  openSearchIndexMappingUrl,
  openSearchIndexTemplateUrl,
  validateOpenSearchDomain,
} from '../vscode/openSearchTemplates';
import { collectTemplateFiles } from './files';
import { CliOptions, RemoteTemplateOptions, SavedOpenSearchMapping } from './types';
import { isRecord } from './utils';

export const DEFAULT_FETCHER: OpenSearchFetcher = (url, options) => fetch(url, options);

function parseSavedOpenSearchCache(value: unknown): IndexTemplate[] | undefined {
  if (!isRecord(value) || value.format !== 'ppl-lint-opensearch-cache' || value.version !== 1) {
    return undefined;
  }

  const templates = parseOpenSearchIndexTemplates(value.indexTemplates);
  if (!Array.isArray(value.mappings)) return templates;
  for (const mapping of value.mappings) {
    if (!isRecord(mapping) || typeof mapping.selector !== 'string') continue;
    templates.push(...parseOpenSearchIndexMappings(mapping.response, mapping.selector));
  }
  return templates;
}

export async function loadLocalTemplates(templatePaths: string[]): Promise<IndexTemplate[]> {
  const templates: IndexTemplate[] = [];
  for (const templatePath of templatePaths) {
    const files = await collectTemplateFiles(templatePath);
    for (const filePath of files) {
      const text = await readFile(filePath, 'utf8');
      const parsed = parseIndexTemplates(text, filePath);
      if (parsed.length > 0) {
        templates.push(...parsed);
        continue;
      }
      if (path.extname(filePath).toLowerCase() === '.json') {
        try {
          const response = JSON.parse(text) as unknown;
          const savedTemplates = parseSavedOpenSearchCache(response);
          templates.push(...(savedTemplates ?? parseOpenSearchIndexTemplates(response)));
        } catch {
          // Invalid or non-template JSON files do not contribute schema data.
        }
      }
    }
  }
  return templates;
}

export function resolveRemoteOptions(options: CliOptions, env: NodeJS.ProcessEnv): RemoteTemplateOptions | undefined {
  const url = options.explicitOpenSearchUrl
    ? options.openSearchUrl
    : env.PPL_OPENSEARCH_URL ?? options.openSearchUrl;
  const username = options.explicitOpenSearchUsername
    ? options.openSearchUsername
    : env.PPL_OPENSEARCH_USERNAME ?? options.openSearchUsername;
  const password = env.PPL_OPENSEARCH_PASSWORD;
  const hasRemoteSelection = options.templateNames.length > 0 || options.mappingIndexes.length > 0;

  if (!url) {
    if (options.saveOpenSearchCache) {
      throw new Error('Saving an OpenSearch cache requires --opensearch-url or PPL_OPENSEARCH_URL.');
    }
    if (hasRemoteSelection) throw new Error('Remote template or mapping options require --opensearch-url.');
    return undefined;
  }

  const validationError = validateOpenSearchDomain(url);
  if (validationError) throw new Error(validationError);
  if (username && !password) throw new Error('Set PPL_OPENSEARCH_PASSWORD when using --opensearch-username.');
  if (password && !username) throw new Error('Set --opensearch-username or PPL_OPENSEARCH_USERNAME when using PPL_OPENSEARCH_PASSWORD.');

  return {
    url,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    templateNames: options.templateNames,
    mappingIndexes: options.mappingIndexes,
  };
}

async function writeOpenSearchCache(
  directory: string,
  indexTemplates: unknown,
  mappings: SavedOpenSearchMapping[]
): Promise<void> {
  const cacheDirectory = path.resolve(directory);
  await mkdir(cacheDirectory, { recursive: true });
  const cache = {
    format: 'ppl-lint-opensearch-cache',
    version: 1,
    indexTemplates,
    mappings,
  };
  await writeFile(
    path.join(cacheDirectory, 'ppl-lint-opensearch-cache.json'),
    `${JSON.stringify(cache, null, 2)}\n`,
    'utf8'
  );
}

export async function fetchRemoteTemplates(
  remote: RemoteTemplateOptions,
  fetcher: OpenSearchFetcher,
  stderr: (text: string) => void,
  saveCacheDirectory?: string
): Promise<IndexTemplate[]> {
  const headers: Record<string, string> = {};
  if (remote.username && remote.password) {
    headers.Authorization = `Basic ${Buffer.from(`${remote.username}:${remote.password}`, 'utf8').toString('base64')}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const mappingResponses: SavedOpenSearchMapping[] = [];
  const requestOptions: OpenSearchFetchOptions = {
    headers,
    signal: controller.signal,
    redirect: 'error',
  };

  try {
    let templateResponse: unknown = { index_templates: [] };
    try {
      const names: Array<string | undefined> = remote.templateNames.length > 0
        ? remote.templateNames
        : [undefined];
      const templatesByName = new Map<string, unknown>();
      for (const name of names) {
        const response = await fetcher(openSearchIndexTemplateUrl(remote.url, name), requestOptions);
        if (!response.ok) {
          throw new Error(`OpenSearch returned HTTP ${response.status} for the index-template request${name ? ` '${name}'` : ''}.`);
        }
        const body = await response.json();
        if (!isRecord(body) || !Array.isArray(body.index_templates)) {
          throw new Error('OpenSearch response did not contain an index_templates array.');
        }
        for (const template of body.index_templates) {
          if (!isRecord(template)) continue;
          const name = typeof template.name === 'string' ? template.name : JSON.stringify(template);
          templatesByName.set(name, template);
        }
      }
      templateResponse = { index_templates: [...templatesByName.values()] };
    } catch (error) {
      if (remote.mappingIndexes.length === 0) throw error;
      const message = error instanceof Error ? error.message : 'Could not fetch index templates.';
      stderr(`warning: ${message} Continuing with live mappings.\n`);
    }

    const templates = parseOpenSearchIndexTemplates(templateResponse);
    for (const pattern of remote.mappingIndexes) {
      const response = await fetcher(openSearchIndexMappingUrl(remote.url, pattern), requestOptions);
      if (!response.ok) {
        throw new Error(`OpenSearch returned HTTP ${response.status} for mapping pattern '${pattern}'.`);
      }
      const body = await response.json();
      if (!isRecord(body)) throw new Error(`OpenSearch returned an invalid mapping response for '${pattern}'.`);
      mappingResponses.push({ selector: pattern, response: body });
      templates.push(...parseOpenSearchIndexMappings(body, pattern));
    }
    if (saveCacheDirectory) {
      await writeOpenSearchCache(saveCacheDirectory, templateResponse, mappingResponses);
    }
    return templates;
  } finally {
    clearTimeout(timeout);
  }
}
