import { Buffer } from 'node:buffer';
import { minimatch } from 'minimatch';
import {
  IndexTemplate,
  parseOpenSearchIndexMappings,
  parseOpenSearchIndexTemplates,
} from '../core/indexTemplates';

export const OPEN_SEARCH_TEMPLATE_CACHE_KEY = 'pplLinter.openSearchTemplateCache';
export const OPEN_SEARCH_REAUTH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OpenSearchTemplateCache {
  domain?: string;
  username?: string;
  lastPromptAt: number;
  response?: unknown;
  templateNames?: string[];
  mappingIndexes?: string[];
  mappingResponses?: Record<string, unknown>;
}

export interface OpenSearchTemplateStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface OpenSearchTemplatePrompts {
  domain(defaultValue?: string): Promise<string | undefined>;
  username(defaultValue?: string): Promise<string | undefined>;
  password(): Promise<string | undefined>;
  error(message: string): void;
  log?(message: string): void;
}

export interface OpenSearchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface OpenSearchFetchOptions {
  headers: Record<string, string>;
  signal?: AbortSignal;
  redirect: 'error';
}

export type OpenSearchFetcher = (
  url: string,
  options: OpenSearchFetchOptions
) => Promise<OpenSearchResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateOpenSearchDomain(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Use HTTPS for remote OpenSearch, or HTTP for a local instance.';
    }
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    if (url.protocol === 'http:' && !loopbackHosts.has(url.hostname)) {
      return 'Use HTTPS when connecting to a remote OpenSearch domain.';
    }
    if (url.username || url.password) {
      return 'Enter the domain without embedded credentials.';
    }
    if (url.search || url.hash) {
      return 'Enter the domain without a query string or fragment.';
    }
    return undefined;
  } catch {
    return 'Enter a valid OpenSearch URL, including http:// or https://.';
  }
}

export function openSearchIndexTemplateUrl(domain: string, templateName?: string): string {
  const validationError = validateOpenSearchDomain(domain);
  if (validationError) throw new Error(validationError);

  const url = new URL(domain.trim());
  const name = templateName?.trim();
  const selection = name ? `/${encodeURIComponent(name).replace(/%2A/gi, '*')}` : '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/_index_template${selection}`;
  return url.toString();
}

export function openSearchIndexMappingUrl(domain: string, indexPattern: string): string {
  const validationError = validateOpenSearchDomain(domain);
  if (validationError) throw new Error(validationError);
  const pattern = indexPattern.trim();
  if (!pattern) throw new Error('OpenSearch mapping index pattern must not be empty.');

  const url = new URL(domain.trim());
  const encodedPattern = encodeURIComponent(pattern).replace(/%2A/gi, '*');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodedPattern}/_mapping`;
  return url.toString();
}

const defaultFetcher: OpenSearchFetcher = (url, options) => fetch(url, options);

export class OpenSearchTemplateSource {
  private cached?: OpenSearchTemplateCache;
  private templateNames: string[] = [];
  private mappingIndexPatterns: string[] = [];
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private refreshRequest?: Promise<void>;
  private disposed = false;

  constructor(
    private readonly storage: OpenSearchTemplateStorage,
    private readonly prompts: OpenSearchTemplatePrompts,
    private readonly onTemplatesChanged: (templates: IndexTemplate[]) => void,
    private readonly fetcher: OpenSearchFetcher = defaultFetcher,
    private readonly now: () => number = Date.now
  ) {}

  public get templates(): IndexTemplate[] {
    if (this.cached?.response === undefined) return [];
    const parsedTemplates = parseOpenSearchIndexTemplates(this.cached.response);
    const templateDefinitions = this.templateNames.length === 0
      ? parsedTemplates
      : parsedTemplates.filter((template) => this.templateNames.some((pattern) => minimatch(template.name, pattern)));
    const mappingDefinitions = this.mappingIndexPatterns.flatMap((pattern) => {
      const response = this.cached?.mappingResponses?.[pattern];
      return response === undefined ? [] : parseOpenSearchIndexMappings(response, pattern);
    });
    return [...templateDefinitions, ...mappingDefinitions];
  }

  public async setTemplateNames(names: readonly string[]): Promise<void> {
    const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort();
    if (normalized.join('\0') === this.templateNames.join('\0')) return;
    this.templateNames = normalized;
    if (!this.cached) return;

    this.onTemplatesChanged(this.templates);
    await this.refresh(true);
  }

  public async setMappingIndexPatterns(patterns: readonly string[]): Promise<void> {
    const normalized = [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))].sort();
    if (normalized.join('\0') === this.mappingIndexPatterns.join('\0')) return;
    this.mappingIndexPatterns = normalized;
    if (!this.cached) return;

    this.onTemplatesChanged(this.templates);
    if (normalized.length > 0) await this.refresh(true);
  }

  public async initialize(): Promise<void> {
    this.cached = this.readCache();
    if (this.cached?.response !== undefined) {
      const templates = this.templates;
      this.log(`Loaded ${templates.length} cached composable index template(s).`);
      this.onTemplatesChanged(templates);
    } else {
      this.log('No cached OpenSearch index templates found.');
    }
    await this.refresh();
  }

  public refresh(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshRequest) return this.refreshRequest;

    this.refreshRequest = this.refreshNow(force).finally(() => {
      this.refreshRequest = undefined;
    });
    return this.refreshRequest;
  }

  private async refreshNow(force: boolean): Promise<void> {
    const templateNamesChanged = (this.cached?.templateNames ?? []).join('\0') !== this.templateNames.join('\0');
    const mappingPatternsChanged = this.mappingIndexPatterns.length > 0 &&
      (this.cached?.mappingIndexes ?? []).join('\0') !== this.mappingIndexPatterns.join('\0');
    if (!force && !templateNamesChanged && !mappingPatternsChanged && this.cached && this.now() - this.cached.lastPromptAt < OPEN_SEARCH_REAUTH_INTERVAL_MS) {
      const refreshDate = new Date(this.cached.lastPromptAt + OPEN_SEARCH_REAUTH_INTERVAL_MS).toLocaleString();
      this.log(`Refresh skipped until ${refreshDate}; run "PPL: Refresh OpenSearch Index Patterns" to retry now.`);
      this.scheduleRefresh();
      return;
    }

    this.log(force ? 'Manual OpenSearch index-template refresh started.' : 'OpenSearch index-template refresh started.');
    const promptedAt = this.now();
    this.cached = { ...this.cached, lastPromptAt: promptedAt };
    await this.persistCache();

    let domain = this.cached.domain;
    let username = this.cached.username;
    try {
      domain = (await this.prompts.domain(this.cached.domain))?.trim();
      if (!domain) {
        this.log('Refresh cancelled at the domain prompt.');
        return;
      }
      const domainError = validateOpenSearchDomain(domain);
      if (domainError) {
        this.log(`Invalid OpenSearch domain: ${domainError}`);
        this.prompts.error(domainError);
        return;
      }

      username = (await this.prompts.username(this.cached.username))?.trim();
      if (!username) {
        this.log('Refresh cancelled at the username prompt.');
        return;
      }
      const password = await this.prompts.password();
      if (password === undefined || password.length === 0) {
        this.log('Refresh cancelled at the password prompt.');
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
        let templateResponse: unknown;
        try {
          const requestedNames: Array<string | undefined> = this.templateNames.length > 0
            ? this.templateNames
            : [undefined];
          const templatesByName = new Map<string, unknown>();
          for (const templateName of requestedNames) {
            const response = await this.fetcher(openSearchIndexTemplateUrl(domain, templateName), {
              headers: { Authorization: authorization },
              signal: controller.signal,
              redirect: 'error',
            });
            if (!response.ok) {
              throw new Error(`OpenSearch returned HTTP ${response.status} for the index-template request${templateName ? ` '${templateName}'` : ''}.`);
            }
            const body = await response.json();
            if (!isRecord(body) || !Array.isArray(body.index_templates)) {
              throw new Error('OpenSearch returned HTTP 200, but the response did not contain an index_templates array.');
            }
            for (const template of body.index_templates) {
              if (!isRecord(template)) continue;
              const templateName = typeof template.name === 'string'
                ? template.name
                : JSON.stringify(template);
              templatesByName.set(templateName, template);
            }
          }
          templateResponse = { index_templates: [...templatesByName.values()] };
        } catch (error) {
          if (this.mappingIndexPatterns.length === 0) throw error;
          templateResponse = this.cached?.response ?? { index_templates: [] };
          const message = error instanceof Error ? error.message : 'Could not fetch index templates.';
          this.log(`WARN: ${message} Continuing with configured live mapping patterns.`);
        }
        const templates = parseOpenSearchIndexTemplates(templateResponse);
        const mappingResponses: Record<string, unknown> = {};
        let mappedIndexCount = 0;
        for (const pattern of this.mappingIndexPatterns) {
          const mappingResponse = await this.fetcher(openSearchIndexMappingUrl(domain, pattern), {
            headers: { Authorization: authorization },
            signal: controller.signal,
            redirect: 'error',
          });
          if (!mappingResponse.ok) {
            throw new Error(`OpenSearch returned HTTP ${mappingResponse.status} for mapping pattern '${pattern}'.`);
          }
          const mappingBody = await mappingResponse.json();
          if (!isRecord(mappingBody)) {
            throw new Error(`OpenSearch returned an invalid mapping response for pattern '${pattern}'.`);
          }
          mappingResponses[pattern] = mappingBody;
          mappedIndexCount += parseOpenSearchIndexMappings(mappingBody, pattern).length;
        }

        const updated: OpenSearchTemplateCache = {
          domain,
          username,
          lastPromptAt: promptedAt,
          response: templateResponse,
          templateNames: this.templateNames,
          mappingIndexes: this.mappingIndexPatterns,
          mappingResponses,
        };
        this.cached = updated;
        await this.persistCache();
        this.onTemplatesChanged(this.templates);
        this.log(`Fetched and parsed ${templates.length} composable index template(s).`);
        if (this.mappingIndexPatterns.length > 0) {
          this.log(`Fetched live mappings for ${mappedIndexCount} index(es) across ${this.mappingIndexPatterns.length} configured pattern(s).`);
        }
        if (templates.length === 0) {
          this.log('The response contained no composable templates with recognized index_patterns.');
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      this.cached = {
        ...this.cached,
        ...(domain ? { domain } : {}),
        ...(username ? { username } : {}),
        lastPromptAt: promptedAt,
      };
      await this.persistCache();
      const message = error instanceof Error ? error.message : 'Could not connect to OpenSearch.';
      this.log(`ERROR: ${message}`);
      this.prompts.error(message);
    } finally {
      this.scheduleRefresh();
    }
  }

  private readCache(): OpenSearchTemplateCache | undefined {
    const value = this.storage.get<unknown>(OPEN_SEARCH_TEMPLATE_CACHE_KEY);
    if (!isRecord(value)) return undefined;
    return {
      ...(typeof value.domain === 'string' ? { domain: value.domain } : {}),
      ...(typeof value.username === 'string' ? { username: value.username } : {}),
      lastPromptAt: typeof value.lastPromptAt === 'number' && Number.isFinite(value.lastPromptAt)
        ? value.lastPromptAt
        : 0,
      ...(Object.prototype.hasOwnProperty.call(value, 'response') ? { response: value.response } : {}),
      ...(Array.isArray(value.templateNames)
        ? { templateNames: value.templateNames.filter((item): item is string => typeof item === 'string') }
        : {}),
      ...(Array.isArray(value.mappingIndexes)
        ? { mappingIndexes: value.mappingIndexes.filter((item): item is string => typeof item === 'string') }
        : {}),
      ...(isRecord(value.mappingResponses) ? { mappingResponses: value.mappingResponses } : {}),
    };
  }

  private async persistCache(): Promise<void> {
    if (!this.cached) return;
    try {
      await this.storage.update(OPEN_SEARCH_TEMPLATE_CACHE_KEY, this.cached);
    } catch {
      const message = 'Could not save the OpenSearch index-template cache.';
      this.log(`ERROR: ${message}`);
      this.prompts.error(message);
    }
  }

  private log(message: string): void {
    this.prompts.log?.(message);
  }

  private scheduleRefresh(): void {
    if (this.disposed || !this.cached) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const nextPromptAt = this.cached.lastPromptAt + OPEN_SEARCH_REAUTH_INTERVAL_MS;
    const delay = Math.max(0, nextPromptAt - this.now());
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, delay);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }
}