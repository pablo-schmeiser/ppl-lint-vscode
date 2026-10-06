import * as path from 'path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseIndexTemplates, resolveSource } from '../../src/core/indexTemplates';
import { absoluteGlobParts, findAbsoluteFiles } from '../../src/vscode/templateFiles';

describe('absolute template globs', () => {
  it('normalizes Windows separators in glob patterns', () => {
    const glob = String.raw`D:\workspace\test\fixtures\**\*.yaml`;
    expect(absoluteGlobParts(glob)).toEqual({
      base: String.raw`D:\workspace\test\fixtures`,
      pattern: '**/*.yaml',
    });
  });

  it('splits the static base from the pattern and discovers matching files', async () => {
    const fixtures = path.resolve('test/fixtures');
    const glob = path.join(fixtures, '**/*.yaml');
    expect(absoluteGlobParts(glob)).toEqual({ base: fixtures, pattern: '**/*.yaml' });
    const matches = await findAbsoluteFiles(glob);
    expect(matches).toContain(path.join(fixtures, 'detection_rule.yaml'));
    expect(matches).not.toContain(path.join(fixtures, 'agent_config.toml'));
  });

  it('loads a template in a directory outside the workspace', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ppl-templates-'));
    try {
      await writeFile(path.join(directory, 'index-template-auditd.yaml'), `kind: OpensearchIndexTemplate
metadata: { name: auditd }
spec:
  indexPatterns: ['auditd-*']
  template:
    aliases: { auditd-reader: {} }
    mappings:
      properties:
        host:
          properties:
            name: { type: keyword }
`);
      const files = await findAbsoluteFiles(path.join(directory, 'index-template-*.yaml'));
      const templates = (await Promise.all(files.map(async (file) =>
        parseIndexTemplates(await readFile(file, 'utf8'), file)
      ))).flat();
      expect(resolveSource(templates, 'auditd-reader').get('host.name')?.types).toEqual(['keyword']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
