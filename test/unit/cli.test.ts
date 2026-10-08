import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli, CliRuntime } from '../../src/cli';
import { OpenSearchFetcher } from '../../src/vscode/openSearchTemplates';

async function withTempDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ppl-lint-cli-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function invoke(args: string[], runtime: Partial<CliRuntime> = {}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(args, {
    ...runtime,
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    stdinIsTty: runtime.stdinIsTty ?? true,
  });
  return { exitCode, stdout, stderr };
}

describe('PPL CLI', () => {
  it('lints a query supplied directly and returns a failing status for errors', async () => {
    const result = await invoke(['--query', 'source=logs | nonsense']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('<query 1>:1:');
    expect(result.stdout).toContain('PPL003');
    expect(result.stdout).toContain('Checked 1 PPL query: 1 error, 0 warnings, 0 informational diagnostics.');
  });

  it('reports a clean text-mode run instead of returning empty output', async () => {
    const result = await invoke(['--query', 'source=logs | head 5']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Checked 1 PPL query: no diagnostics.\n');
  });

  it('describes input and output formats in help', async () => {
    const result = await invoke(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Read .ppl, .pplquery, .query, .yaml, .yml,');
    expect(result.stdout).toContain('--save-opensearch-cache <dir>');
    expect(result.stdout).toContain('With no query, file, or explicit stdin input, this performs a fetch-only run.');
    expect(result.stdout).toContain('A JSON array of diagnostics on stdout. An empty array means no findings.');
    expect(result.stdout).toContain('Exit status: 0 means no errors');
  });

  it('loads shared config for queries, extraction, rules, and CLI defaults', async () => {
    await withTempDirectory(async (directory) => {
      const configPath = path.join(directory, '.ppl-lint.jsonc');
      const yamlPath = path.join(directory, 'alert.yaml');
      await writeFile(configPath, `{
        // Shared host-neutral parsing and lint configuration.
        "version": 1,
        "pplLinter": {
          "openSearchVersion": "3.6",
          "customCommands": ["custompipe"],
          "embedded": [{
            "id": "custom-yaml-query",
            "filePattern": "**/*.yaml",
            "format": "yaml",
            "keyPatterns": ["ppl_query"],
            "heuristicDetection": false
          }],
          "rules": { "PPL003": "warning", "PPL008": "off" }
        },
        "cli": {
          "queries": ["source=logs | nonsense", "source=logs | custompipe"],
          "outputFormat": "json"
        }
      }`);

      const configuredResult = await invoke(['--config', configPath]);
      const configuredDiagnostics = JSON.parse(configuredResult.stdout) as Array<Record<string, unknown>>;
      expect(configuredResult.exitCode, `${configuredResult.stderr}${configuredResult.stdout}`).toBe(0);
      expect(configuredDiagnostics.filter(({ code }) => code === 'PPL003')).toHaveLength(1);
      expect(configuredDiagnostics.find(({ code }) => code === 'PPL003')).toMatchObject({ severity: 'warning' });
      expect(configuredDiagnostics.filter(({ code }) => code === 'PPL009')).toHaveLength(2);
      expect(configuredDiagnostics.some(({ code }) => code === 'PPL008')).toBe(false);

      await writeFile(yamlPath, [
        'ppl_query: "source=logs | nonsense"',
        'query: "source=logs | nonsense"',
      ].join('\n'));
      const embeddedResult = await invoke(['--config', configPath, yamlPath]);
      const embeddedDiagnostics = JSON.parse(embeddedResult.stdout) as Array<Record<string, unknown>>;
      expect(embeddedDiagnostics.filter(({ code }) => code === 'PPL003')).toHaveLength(1);
      expect(embeddedDiagnostics.every(({ keyPath }) => keyPath === 'ppl_query')).toBe(true);

      const overrideResult = await invoke([
        '--config', configPath,
        '--query', 'source=logs | head 1',
        '--opensearch-version', '3.4',
        '--format', 'json',
      ]);
      const overrideDiagnostics = JSON.parse(overrideResult.stdout) as Array<Record<string, unknown>>;
      expect(overrideResult.exitCode).toBe(1);
      expect(overrideDiagnostics).toHaveLength(1);
      expect(overrideDiagnostics[0]).toMatchObject({ code: 'PPL010', file: '<query 1>' });
    });
  });

  it('uses shared OpenSearch selections for fetch-only cache preparation', async () => {
    await withTempDirectory(async (directory) => {
      const configPath = path.join(directory, '.ppl-lint.jsonc');
      const cacheDirectory = path.join(directory, 'schema-cache');
      await writeFile(configPath, JSON.stringify({
        version: 1,
        pplLinter: {
          openSearchUrl: 'https://search.example.test',
          openSearchUsername: 'reader',
          openSearchTemplateNames: ['auditd-*', 'syslog-*'],
          openSearchMappingIndexes: ['mam_*'],
        },
        cli: { saveOpenSearchCache: './schema-cache' },
      }));
      const requests: Array<{ url: string; authorization?: string }> = [];
      const fetcher: OpenSearchFetcher = async (url, options) => {
        requests.push({ url, authorization: options.headers.Authorization });
        return {
          ok: true,
          status: 200,
          json: async () => url.endsWith('/_mapping')
            ? { mam_users: { mappings: { properties: { id: { type: 'keyword' } } } } }
            : { index_templates: [] },
        };
      };

      const result = await invoke(['--config', configPath], {
        env: { PPL_OPENSEARCH_PASSWORD: 'config-test-password' },
        fetcher,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`Saved OpenSearch cache to ${cacheDirectory}.\n`);
      expect(requests.map(({ url }) => url)).toEqual([
        'https://search.example.test/_index_template/auditd-*',
        'https://search.example.test/_index_template/syslog-*',
        'https://search.example.test/mam_*/_mapping',
      ]);
      expect(requests.every(({ authorization }) =>
        authorization === `Basic ${Buffer.from('reader:config-test-password').toString('base64')}`
      )).toBe(true);
      expect(result.stdout + result.stderr).not.toContain('config-test-password');
      expect(await readFile(path.join(cacheDirectory, 'ppl-lint-opensearch-cache.json'), 'utf8')).toContain(
        'ppl-lint-opensearch-cache'
      );
    });
  });

  it('scans standalone and embedded queries in a directory', async () => {
    await withTempDirectory(async (directory) => {
      await writeFile(path.join(directory, 'query.ppl'), 'source=logs | nonsense\n');
      await writeFile(path.join(directory, 'alert.yaml'), 'rule:\n  query: |\n    source=logs\n    | nonsense\n');
      await writeFile(path.join(directory, 'notes.txt'), 'not PPL input\n');

      const result = await invoke([directory]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('query.ppl');
      expect(result.stdout).toContain('alert.yaml [rule.query]:4:');
      expect(result.stdout).not.toContain('notes.txt');
    });
  });

  it('reads piped stdin automatically as a PPL query', async () => {
    const input = (async function* () {
      yield 'source=logs | nonsense';
    })();
    const result = await invoke([], { stdin: input, stdinIsTty: false });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('<stdin>:1:');
    expect(result.stdout).toContain('PPL003');
  });

  it('lints corpus results once and retains each result ID and family', async () => {
    await withTempDirectory(async (directory) => {
      const corpusPath = path.join(directory, 'corpus.json');
      const record = {
        id: 'query-42',
        family: 'unknown-command',
        query: 'source=logs | nonsense',
        verdict: { kind: 'rejected' },
        diagnostics: [],
      };
      await writeFile(corpusPath, JSON.stringify({
        version: '3.5.0',
        results: [record],
        mismatches: [{ ...record, expected: { kind: 'rejected' } }],
      }));

      const result = await invoke(['--corpus', corpusPath, '--format', 'json']);
      const diagnostics = JSON.parse(result.stdout) as Array<Record<string, unknown>>;

      expect(result.exitCode).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        keyPath: 'results.0.query',
        corpusId: 'query-42',
        family: 'unknown-command',
        code: 'PPL003',
      });
    });
  });

  it('loads local template files for schema checking', async () => {
    await withTempDirectory(async (directory) => {
      const templatePath = path.join(directory, 'index-template.yaml');
      await writeFile(templatePath, [
        'kind: OpensearchIndexTemplate',
        'metadata:',
        '  name: logs-template',
        'spec:',
        '  indexPatterns:',
        '    - logs-*',
        '  template:',
        '    mappings:',
        '      properties:',
        '        host:',
        '          type: keyword',
        '',
      ].join('\n'));

      const result = await invoke([
        '--format', 'json',
        '--template', templatePath,
        '--query', 'source=logs-2026 | fields host',
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
    });
  });

  it('ignores unused OpenSearch credentials for offline linting', async () => {
    await withTempDirectory(async (directory) => {
      const templatePath = path.join(directory, 'index-template.yaml');
      await writeFile(templatePath, [
        'kind: OpensearchIndexTemplate',
        'metadata:',
        '  name: logs-template',
        'spec:',
        '  indexPatterns:',
        '    - logs-*',
        '  template:',
        '    mappings:',
        '      properties:',
        '        host:',
        '          type: keyword',
        '',
      ].join('\n'));

      const result = await invoke([
        '--template', templatePath,
        '--query', 'source=logs-2026 | fields host',
      ], {
        env: {
          PPL_OPENSEARCH_USERNAME: 'reader',
          PPL_OPENSEARCH_PASSWORD: 'unused-password',
        },
        fetcher: async () => { throw new Error('offline lint must not fetch OpenSearch'); },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Checked 1 PPL query: no diagnostics.');
    });
  });

  it('still requires a URL when remote selections are requested', async () => {
    const result = await invoke([
      '--opensearch-template', 'logs-*',
      '--query', 'source=logs | head 1',
    ], {
      env: { PPL_OPENSEARCH_USERNAME: 'reader' },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Remote template or mapping options require --opensearch-url.');
  });

  it('fetches templates and mappings with Basic auth without exposing the password', async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const fetcher: OpenSearchFetcher = async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization });
      return {
        ok: true,
        status: 200,
        json: async () => url.endsWith('/_mapping')
          ? { 'logs-2026': { mappings: { properties: { host: { type: 'keyword' } } } } }
          : {
            index_templates: [{
              name: 'logs-template',
              index_template: {
                index_patterns: ['logs-*'],
                template: { mappings: { properties: { host: { type: 'keyword' } } } },
              },
            }],
          },
      };
    };

    const result = await invoke([
      '--format', 'json',
      '--opensearch-url', 'https://search.example.test',
      '--opensearch-username', 'reader',
      '--mapping-index', 'logs-*',
      '--query', 'source=logs-2026 | fields host',
    ], {
      env: { PPL_OPENSEARCH_PASSWORD: 'not-for-output' },
      fetcher,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(requests.map((request) => request.url)).toEqual([
      'https://search.example.test/_index_template',
      'https://search.example.test/logs-*/_mapping',
    ]);
    expect(requests[0].authorization).toBe(`Basic ${Buffer.from('reader:not-for-output').toString('base64')}`);
    expect(result.stdout + result.stderr).not.toContain('not-for-output');
  });

  it('fetches without query input and saves templates and mappings for offline reuse', async () => {
    await withTempDirectory(async (directory) => {
      const cacheDirectory = path.join(directory, 'schema-cache');
      const fetcher: OpenSearchFetcher = async (url) => ({
        ok: true,
        status: 200,
        json: async () => url.endsWith('/_mapping')
          ? {
            'logs-2026': {
              mappings: { properties: { mapped_host: { type: 'keyword' } } },
            },
          }
          : {
            index_templates: [{
              name: 'logs-template',
              index_template: {
                index_patterns: ['logs-*'],
                template: { mappings: { properties: { template_host: { type: 'keyword' } } } },
              },
            }],
          },
      });

      const onlineResult = await invoke([
        '--opensearch-url', 'https://search.example.test',
        '--opensearch-template', 'logs-*',
        '--mapping-index', 'logs-*',
        '--save-opensearch-cache', cacheDirectory,
      ], { fetcher, stdinIsTty: false });

      expect(onlineResult.exitCode).toBe(0);
      expect(onlineResult.stdout).toBe(`Saved OpenSearch cache to ${path.resolve(cacheDirectory)}.\n`);
      expect(onlineResult.stderr).toBe('');
      const cacheText = await readFile(path.join(cacheDirectory, 'ppl-lint-opensearch-cache.json'), 'utf8');
      expect(JSON.parse(cacheText)).toMatchObject({
        format: 'ppl-lint-opensearch-cache',
        version: 1,
        mappings: [{ selector: 'logs-*' }],
      });

      const offlineResult = await invoke([
        '--format', 'json',
        '--template', cacheDirectory,
        '--query', 'source=logs-2026 | fields mapped_host',
      ]);

      expect(offlineResult.exitCode).toBe(0);
      expect(JSON.parse(offlineResult.stdout)).toEqual([]);
    });
  });
});
