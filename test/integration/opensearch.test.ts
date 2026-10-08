import { OpenSearchContainer } from '@testcontainers/opensearch';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { runCli } from '../../src/cli';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';

describe('OpenSearch Integration', () => {
  let container: any;
  let opensearchUrl: string;

  beforeAll(async () => {
    // Start OpenSearch with security enabled
    container = await new OpenSearchContainer('opensearchproject/opensearch:latest')
      .withEnvironment({ 'OPENSEARCH_INITIAL_ADMIN_PASSWORD': 'Admin123!' })
      .start();
    opensearchUrl = container.getHttpUri();
    
    // Seed some test data: an index template
    const templateBody = {
      index_patterns: ['logs-*'],
      template: {
        mappings: {
          properties: {
            host: { type: 'keyword' },
            message: { type: 'text' },
            status: { type: 'integer' }
          }
        }
      }
    };
    
    const authHeader = 'Basic ' + Buffer.from('admin:Admin123!').toString('base64');

    const templateRes = await fetch(`${opensearchUrl}/_index_template/logs-template`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(templateBody)
    });
    
    if (!templateRes.ok) {
      throw new Error(`Failed to create index template: ${await templateRes.text()}`);
    }

    // Seed a specific index with a mapping
    const indexRes = await fetch(`${opensearchUrl}/mam_users`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        mappings: {
          properties: {
            id: { type: 'keyword' },
            name: { type: 'text' }
          }
        }
      })
    });

    if (!indexRes.ok) {
      throw new Error(`Failed to create index: ${await indexRes.text()}`);
    }
  }, 120000);

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  async function withTempDirectory(action: (directory: string) => Promise<void>): Promise<void> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ppl-lint-integration-'));
    try {
      await action(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async function invoke(args: string[], runtime: any = {}) {
    let stdout = '';
    let stderr = '';
    const exitCode = await runCli(args, {
      ...runtime,
      stdout: (text: string) => { stdout += text; },
      stderr: (text: string) => { stderr += text; },
      stdinIsTty: runtime.stdinIsTty ?? true,
    });
    return { exitCode, stdout, stderr };
  }

  it('fetches templates with valid credentials', async () => {
    const result = await invoke([
      '--opensearch-url', opensearchUrl,
      '--opensearch-username', 'admin',
      '--opensearch-template', 'logs-*',
      '--query', 'source=logs-2026 | fields host, status',
    ], { env: { PPL_OPENSEARCH_PASSWORD: 'Admin123!' } });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Checked 1 PPL query: no diagnostics.');
  });

  it('reports error when fetching an invalid field from a template', async () => {
    const result = await invoke([
      '--format', 'json',
      '--opensearch-url', opensearchUrl,
      '--opensearch-username', 'admin',
      '--opensearch-template', 'logs-*',
      '--query', 'source=logs-2026 | fields unknown_field',
    ], { env: { PPL_OPENSEARCH_PASSWORD: 'Admin123!' } });
    
    const diagnostics = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    expect(result.exitCode).toBe(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'PPL012', message: expect.stringContaining('unknown_field') });
  });

  it('fetches mappings for a specific index', async () => {
    const result = await invoke([
      '--format', 'json',
      '--opensearch-url', opensearchUrl,
      '--opensearch-username', 'admin',
      '--mapping-index', 'mam_users',
      '--query', 'source=mam_users | fields id, name',
    ], { env: { PPL_OPENSEARCH_PASSWORD: 'Admin123!' } });
    
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  it('handles invalid credentials/authentication errors', async () => {
    const result = await invoke([
      '--opensearch-url', opensearchUrl,
      '--opensearch-username', 'admin',
      '--opensearch-template', 'logs-*',
      '--query', 'source=logs | head 1',
    ], { env: { PPL_OPENSEARCH_PASSWORD: 'WrongPassword!' } });
    
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Unauthorized|401/i);
  });

  it('tests offline cache generation --save-opensearch-cache', async () => {
    await withTempDirectory(async (directory) => {
      const cacheDirectory = path.join(directory, 'schema-cache');
      
      const onlineResult = await invoke([
        '--opensearch-url', opensearchUrl,
        '--opensearch-username', 'admin',
        '--opensearch-template', 'logs-*',
        '--mapping-index', 'mam_users',
        '--save-opensearch-cache', cacheDirectory,
      ], { stdinIsTty: false, env: { PPL_OPENSEARCH_PASSWORD: 'Admin123!' } });

      expect(onlineResult.exitCode).toBe(0);
      expect(onlineResult.stdout).toContain(`Saved OpenSearch cache to`);

      // Verify the cache works offline
      const offlineResult = await invoke([
        '--format', 'json',
        '--template', cacheDirectory,
        '--query', 'source=logs-2026 | fields host, status',
      ]);

      expect(offlineResult.exitCode).toBe(0);
      expect(JSON.parse(offlineResult.stdout)).toEqual([]);
      
      const offlineErrorResult = await invoke([
        '--format', 'json',
        '--template', cacheDirectory,
        '--query', 'source=mam_users | fields not_exist',
      ]);
      
      const diagnostics = JSON.parse(offlineErrorResult.stdout) as Array<Record<string, unknown>>;
      expect(offlineErrorResult.exitCode).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ code: 'PPL012', message: expect.stringContaining('not_exist') });
    });
  });
});
