import { describe, expect, it } from 'vitest';
import {
  createDefaultPplConfig,
  mergePplConfigFile,
  mergePplLinterConfig,
  parsePplConfigFile,
} from '../../src/projectConfig';

describe('shared PPL config', () => {
  it('keeps the full CLI and linter defaults in the shared config module', () => {
    const config = createDefaultPplConfig();

    expect(config.pplLinter).toMatchObject({
      enabled: true,
      openSearchVersion: '3.5',
      standalone: { fileExtensions: ['.ppl', '.pplquery', '.query'], languageIds: ['ppl'] },
      rules: { PPL001: 'error', PPL003: 'error', PPL005: 'warning' },
      lintOnType: true,
      debounceMs: 350,
    });
    expect(config.cli).toEqual({
      inputs: [],
      queries: [],
      corpusPaths: [],
      templatePaths: [],
      stdinFormat: 'ppl',
      outputFormat: 'text',
    });
    expect(mergePplConfigFile({ version: 1, pplLinter: {}, cli: {} })).toEqual(config);
  });

  it('parses JSONC and merges configured settings over shared defaults', () => {
    const parsed = parsePplConfigFile(`{
      // Shared by the CLI and VS Code extension.
      "version": 1,
      "pplLinter": {
        "openSearchVersion": "3.6",
        "includedIndexes": ["mam_*"] ,
        "standalone": { "fileExtensions": [".pplx"] },
        "embedded": [{
          "id": "custom-yaml",
          "filePattern": "**/*.yaml",
          "format": "yaml",
          "keyPatterns": ["query"]
        }],
        "rules": { "PPL003": "off" }
      },
      "cli": { "outputFormat": "json" }
    }`);
    const config = mergePplLinterConfig(parsed.pplLinter);

    expect(config.openSearchVersion).toBe('3.6');
    expect(config.includedIndexes).toEqual(['mam_*']);
    expect(config.standalone).toEqual({
      fileExtensions: ['.pplx'],
      languageIds: ['ppl'],
    });
    expect(config.rules.PPL003).toBe('off');
    expect(config.rules.PPL002).toBe('error');
    expect(config.embedded[0].heuristicDetection).toBe(true);
    expect(parsed.cli.outputFormat).toBe('json');
  });

  it('rejects unsupported config properties and invalid values', () => {
    expect(() => parsePplConfigFile('{ "pplLinter": { "opensearchVersion": "3.5" } }'))
      .toThrow("Unknown pplLinter config property 'opensearchVersion'");
    expect(() => parsePplConfigFile('{ "version": 2 }')).toThrow('version must be 1');
    expect(() => parsePplConfigFile('{ "cli": { "outputFormat": "yaml" } }'))
      .toThrow('cli.outputFormat must be text or json');
  });
});