import { describe, expect, it } from 'vitest';
import {
  OPEN_SEARCH_REAUTH_INTERVAL_MS,
  OPEN_SEARCH_TEMPLATE_CACHE_KEY,
  OpenSearchFetcher,
  OpenSearchTemplateCache,
  OpenSearchTemplatePrompts,
  OpenSearchTemplateSource,
  OpenSearchTemplateStorage,
  openSearchIndexMappingUrl,
  openSearchIndexTemplateUrl,
  validateOpenSearchDomain,
} from '../../src/vscode/openSearchTemplates';
import { resolveSource } from '../../src/core/indexTemplates';

class MemoryStorage implements OpenSearchTemplateStorage {
  public value?: unknown;

  public get<T>(_key: string): T | undefined {
    return this.value as T | undefined;
  }

  public async update(_key: string, value: unknown): Promise<void> {
    this.value = JSON.parse(JSON.stringify(value)) as unknown;
  }
}

function prompts(logs: string[] = []): OpenSearchTemplatePrompts {
  return {
    domain: async () => 'https://search.example.test/proxy/',
    username: async () => 'reader',
    password: async () => 'do-not-cache-this',
    error: (message) => { throw new Error(message); },
    log: (message) => { logs.push(message); },
  };
}

const templateResponse = {
  index_templates: [{
    name: 'auditd-template',
    index_template: {
      index_patterns: ['auditd-*'],
      template: {
        mappings: { properties: { host: { type: 'keyword' } } },
      },
    },
  }],
};

function namedTemplateResponse(name: string, pattern: string) {
  return {
    index_templates: [{
      name,
      index_template: {
        index_patterns: [pattern],
        template: { mappings: { properties: { id: { type: 'keyword' } } } },
      },
    }],
  };
}

describe('OpenSearch template source', () => {
  it('uses configured connection values and refreshes cache from a different domain', async () => {
    const storage = new MemoryStorage();
    storage.value = {
      domain: 'https://old.example.test',
      username: 'old-reader',
      lastPromptAt: 999_000,
      response: templateResponse,
      templateNames: [],
      mappingIndexes: [],
      mappingResponses: {},
    };
    const promptCalls: string[] = [];
    const requests: Array<{ url: string; authorization?: string }> = [];
    const fetcher: OpenSearchFetcher = async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization });
      return { ok: true, status: 200, json: async () => templateResponse };
    };
    const source = new OpenSearchTemplateSource(
      storage,
      {
        domain: async () => { promptCalls.push('domain'); return undefined; },
        username: async () => { promptCalls.push('username'); return undefined; },
        password: async () => 'config-test-password',
        error: (message) => { throw new Error(message); },
        log: () => undefined,
      },
      () => undefined,
      fetcher,
      () => 1_000_000
    );

    try {
      source.setConnectionDefaults('https://configured.example.test', 'configured-reader');
      await source.initialize();

      expect(promptCalls).toEqual([]);
      expect(requests).toEqual([{
        url: 'https://configured.example.test/_index_template',
        authorization: `Basic ${Buffer.from('configured-reader:config-test-password').toString('base64')}`,
      }]);
      expect(JSON.stringify(storage.value)).not.toContain('config-test-password');
    } finally {
      source.dispose();
    }
  });

  it('fetches native templates with Basic auth and caches no password', async () => {
    const storage = new MemoryStorage();
    const requests: Array<{ url: string; authorization: string | undefined; redirect: string }> = [];
    const logs: string[] = [];
    const fetcher: OpenSearchFetcher = async (url, options) => {
      requests.push({
        url,
        authorization: options.headers.Authorization,
        redirect: options.redirect,
      });
      return { ok: true, status: 200, json: async () => templateResponse };
    };
    let now = 1_000_000;
    let changed: string[] = [];
    const source = new OpenSearchTemplateSource(
      storage,
      prompts(logs),
      (templates) => { changed = templates.map((template) => template.name); },
      fetcher,
      () => now
    );

    try {
      await source.initialize();

      expect(requests).toEqual([{
        url: 'https://search.example.test/proxy/_index_template',
        authorization: `Basic ${Buffer.from('reader:do-not-cache-this').toString('base64')}`,
        redirect: 'error',
      }]);
      expect(changed).toEqual(['auditd-template']);
      expect(source.templates[0].patterns).toEqual(['auditd-*']);
      expect(logs).toContain('Fetched and parsed 1 composable index template(s).');
      expect(logs.join('\n')).not.toContain('do-not-cache-this');
      expect(JSON.stringify(storage.get<OpenSearchTemplateCache>(OPEN_SEARCH_TEMPLATE_CACHE_KEY)))
        .not.toContain('do-not-cache-this');

      const previousPromptAt = storage.get<OpenSearchTemplateCache>(OPEN_SEARCH_TEMPLATE_CACHE_KEY)!.lastPromptAt;
      source.dispose();

      now = previousPromptAt + OPEN_SEARCH_REAUTH_INTERVAL_MS - 60_000;
      let prompted = false;
      const cachedSource = new OpenSearchTemplateSource(
        storage,
        { ...prompts(), domain: async () => { prompted = true; return undefined; } },
        () => undefined,
        fetcher,
        () => now
      );
      await cachedSource.initialize();
      expect(prompted).toBe(false);
      expect(requests).toHaveLength(1);
      cachedSource.dispose();

      now = previousPromptAt + OPEN_SEARCH_REAUTH_INTERVAL_MS;
      const dueSource = new OpenSearchTemplateSource(storage, prompts(), () => undefined, fetcher, () => now);
      await dueSource.initialize();
      expect(requests).toHaveLength(2);
      dueSource.dispose();
    } finally {
      source.dispose();
    }
  });

  it('fetches only configured template-name patterns and merges the responses', async () => {
    const storage = new MemoryStorage();
    const requests: string[] = [];
    const fetcher: OpenSearchFetcher = async (url) => {
      requests.push(url);
      const response = url.endsWith('/_index_template/mam_*')
        ? namedTemplateResponse('mam_users', 'mam_users-*')
        : namedTemplateResponse('security-rules', 'security-*');
      return { ok: true, status: 200, json: async () => response };
    };
    const source = new OpenSearchTemplateSource(storage, prompts(), () => undefined, fetcher, () => 1_000_000);

    try {
      await source.setTemplateNames(['mam_*', 'security-*']);
      await source.initialize();

      expect(requests).toEqual([
        'https://search.example.test/proxy/_index_template/mam_*',
        'https://search.example.test/proxy/_index_template/security-*',
      ]);
      expect(source.templates.map((template) => template.name).sort()).toEqual(['mam_users', 'security-rules']);
      expect(storage.get<OpenSearchTemplateCache>(OPEN_SEARCH_TEMPLATE_CACHE_KEY)?.templateNames)
        .toEqual(['mam_*', 'security-*']);
    } finally {
      source.dispose();
    }
  });

  it('refreshes and filters cached templates when the configured name list changes', async () => {
    const storage = new MemoryStorage();
    const requests: string[] = [];
    const fetcher: OpenSearchFetcher = async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => url.endsWith('/_index_template/mam_*')
          ? namedTemplateResponse('mam_users', 'mam_users-*')
          : namedTemplateResponse('security-rules', 'security-*'),
      };
    };
    const source = new OpenSearchTemplateSource(storage, prompts(), () => undefined, fetcher, () => 1_000_000);

    try {
      await source.setTemplateNames(['mam_*']);
      await source.initialize();
      expect(source.templates.map((template) => template.name)).toEqual(['mam_users']);

      await source.setTemplateNames(['security-*']);

      expect(requests).toEqual([
        'https://search.example.test/proxy/_index_template/mam_*',
        'https://search.example.test/proxy/_index_template/security-*',
      ]);
      expect(source.templates.map((template) => template.name)).toEqual(['security-rules']);
    } finally {
      source.dispose();
    }
  });

  it('refreshes template and mapping selections together', async () => {
    const storage = new MemoryStorage();
    const requests: string[] = [];
    const fetcher: OpenSearchFetcher = async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => url.endsWith('/_mapping')
          ? { mam_users: { mappings: { properties: { id: { type: 'keyword' } } } } }
          : url.endsWith('/_index_template/mam_*')
            ? namedTemplateResponse('mam_users', 'mam_users-*')
            : templateResponse,
      };
    };
    const source = new OpenSearchTemplateSource(storage, prompts(), () => undefined, fetcher, () => 1_000_000);

    try {
      await source.initialize();
      requests.length = 0;

      await source.setSelections(['mam_*'], ['mam_*']);

      expect(requests).toEqual([
        'https://search.example.test/proxy/_index_template/mam_*',
        'https://search.example.test/proxy/mam_*/_mapping',
      ]);
      expect(source.templates.map((template) => template.name)).toEqual([
        'mam_users',
        'mapping:mam_*:mam_users',
      ]);
    } finally {
      source.dispose();
    }
  });

  it('fetches configured live mapping patterns and merges their schemas with templates', async () => {
    const storage = new MemoryStorage();
    const requests: string[] = [];
    const mappingResponse = {
      mam_users_2026: {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            department: { type: 'keyword' },
          },
        },
      },
      mam_roles_2026: {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            role_level: { type: 'integer' },
          },
        },
      },
    };
    const fetcher: OpenSearchFetcher = async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => url.endsWith('/_mapping') ? mappingResponse : templateResponse,
      };
    };
    const source = new OpenSearchTemplateSource(storage, prompts(), () => undefined, fetcher, () => 1_000_000);

    try {
      await source.setMappingIndexPatterns(['mam_*']);
      await source.initialize();

      expect(requests).toEqual([
        'https://search.example.test/proxy/_index_template',
        'https://search.example.test/proxy/mam_*/_mapping',
      ]);
      const fields = resolveSource(source.templates, 'mam_*');
      expect(fields.get('department')?.types).toEqual(['keyword']);
      expect(fields.get('role_level')?.pplTypes).toEqual(['int']);
      expect(source.templates.some((template) => template.patterns.includes('auditd-*'))).toBe(true);
      expect(storage.get<OpenSearchTemplateCache>(OPEN_SEARCH_TEMPLATE_CACHE_KEY)?.mappingIndexes).toEqual(['mam_*']);
      expect(JSON.stringify(storage.get<OpenSearchTemplateCache>(OPEN_SEARCH_TEMPLATE_CACHE_KEY)))
        .not.toContain('do-not-cache-this');
    } finally {
      source.dispose();
    }
  });

  it('refreshes when the configured mapping index list changes', async () => {
    const storage = new MemoryStorage();
    const requests: string[] = [];
    const fetcher: OpenSearchFetcher = async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => url.endsWith('/_mapping')
          ? { mam_users_2026: { mappings: { properties: { id: { type: 'keyword' } } } } }
          : templateResponse,
      };
    };
    const source = new OpenSearchTemplateSource(storage, prompts(), () => undefined, fetcher, () => 1_000_000);

    try {
      await source.initialize();
      await source.setMappingIndexPatterns(['mam_*']);

      expect(requests).toEqual([
        'https://search.example.test/proxy/_index_template',
        'https://search.example.test/proxy/_index_template',
        'https://search.example.test/proxy/mam_*/_mapping',
      ]);
      expect(resolveSource(source.templates, 'mam_*').get('id')?.types).toEqual(['keyword']);
    } finally {
      source.dispose();
    }
  });

  it('fetches configured mappings when the account cannot read index templates', async () => {
    const storage = new MemoryStorage();
    const requests: string[] = [];
    const logs: string[] = [];
    const mappingResponse = {
      mam_users_2026: {
        mappings: { properties: { department: { type: 'keyword' } } },
      },
    };
    const fetcher: OpenSearchFetcher = async (url) => {
      requests.push(url);
      return url.endsWith('/_mapping')
        ? { ok: true, status: 200, json: async () => mappingResponse }
        : { ok: false, status: 403, json: async () => ({}) };
    };
    const source = new OpenSearchTemplateSource(storage, prompts(logs), () => undefined, fetcher, () => 1_000_000);

    try {
      await source.setMappingIndexPatterns(['mam_*']);
      await source.initialize();

      expect(requests).toEqual([
        'https://search.example.test/proxy/_index_template',
        'https://search.example.test/proxy/mam_*/_mapping',
      ]);
      expect(resolveSource(source.templates, 'mam_*').get('department')?.types).toEqual(['keyword']);
      expect(logs.some((message) => message.includes('Continuing with configured live mapping patterns'))).toBe(true);
    } finally {
      source.dispose();
    }
  });

  it('validates domain URLs and appends the native template endpoint', () => {
    expect(validateOpenSearchDomain('https://user:password@search.example.test')).toContain('credentials');
    expect(validateOpenSearchDomain('file:///tmp/search')).toContain('HTTPS');
    expect(validateOpenSearchDomain('http://search.example.test')).toContain('Use HTTPS');
    expect(validateOpenSearchDomain('http://localhost:9200')).toBeUndefined();
    expect(openSearchIndexTemplateUrl('https://search.example.test/proxy/'))
      .toBe('https://search.example.test/proxy/_index_template');
    expect(openSearchIndexTemplateUrl('https://search.example.test/proxy/', 'mam_*'))
      .toBe('https://search.example.test/proxy/_index_template/mam_*');
    expect(openSearchIndexMappingUrl('https://search.example.test/proxy/', 'mam_*'))
      .toBe('https://search.example.test/proxy/mam_*/_mapping');
  });

  it('keeps the previous template cache and stores no password when a refresh fails', async () => {
    const storage = new MemoryStorage();
    storage.value = {
      domain: 'https://old.example.test',
      username: 'old-reader',
      lastPromptAt: 0,
      response: templateResponse,
    };
    const messages: string[] = [];
    const failedPrompts: OpenSearchTemplatePrompts = {
      domain: async () => 'https://new.example.test',
      username: async () => 'new-reader',
      password: async () => 'still-not-cached',
      error: (message) => { messages.push(message); },
    };
    const failedFetcher: OpenSearchFetcher = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    const source = new OpenSearchTemplateSource(
      storage,
      failedPrompts,
      () => undefined,
      failedFetcher,
      () => OPEN_SEARCH_REAUTH_INTERVAL_MS
    );

    try {
      await source.initialize();
      const cached = storage.get<OpenSearchTemplateCache>(OPEN_SEARCH_TEMPLATE_CACHE_KEY)!;
      expect(cached.domain).toBe('https://new.example.test');
      expect(cached.username).toBe('new-reader');
      expect(source.templates[0].name).toBe('auditd-template');
      expect(JSON.stringify(cached)).not.toContain('still-not-cached');
      expect(messages).toEqual(['OpenSearch returned HTTP 401 for the index-template request.']);
    } finally {
      source.dispose();
    }
  });
});
