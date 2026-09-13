import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { PplLinter } from '../../src/core/linter';
import { extractQueries } from '../../src/extractors/extractor';

describe('End-to-End Pipeline Integration', () => {
  const linter = new PplLinter();
  const fixturesDir = path.resolve(__dirname, '../fixtures');

  it('lints valid standalone PPL fixture with 0 errors', () => {
    const validCode = fs.readFileSync(path.join(fixturesDir, 'valid_query.ppl'), 'utf-8');
    const diagnostics = linter.lint(validCode);
    expect(diagnostics).toHaveLength(0);
  });

  it('lints invalid standalone PPL fixture and flags multiple errors (PPL001, PPL003, PPL007)', () => {
    const invalidCode = fs.readFileSync(path.join(fixturesDir, 'invalid_syntax.ppl'), 'utf-8');
    const diagnostics = linter.lint(invalidCode);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === 'PPL001')).toBe(true); // unclosed paren / trailing pipe
    expect(diagnostics.some((d) => d.code === 'PPL003')).toBe(true); // unknown command 'stat' -> 'stats'
    expect(diagnostics.some((d) => d.code === 'PPL007')).toBe(true); // assignment '=' in where condition
  });

  it('end-to-end linting on detection_rule.yaml with zero coordinate drift', () => {
    const yamlText = fs.readFileSync(path.join(fixturesDir, 'detection_rule.yaml'), 'utf-8');
    const queries = extractQueries(yamlText, 'yaml', ['condition.query', '*.condition.query'], false);

    expect(queries).toHaveLength(1);
    const query = queries[0];

    // Lint the extracted query
    const diagnostics = linter.lint(query.rawText);
    // detection_rule.yaml contains: where count > 50 placed after stats count() -> PPL006 LateFilterWarning!
    const ppl006 = diagnostics.find((d) => d.code === 'PPL006');
    expect(ppl006).toBeDefined();

    if (ppl006) {
      const hostRange = query.sourceMap.translate(ppl006.span);
      const lines = yamlText.split(/\r?\n/);
      const targetLine = lines[hostRange.start.line];

      // Verify exact line: line must contain "| where count > 50"
      expect(targetLine).toContain('| where count > 50');

      // Verify exact column alignment: host line has 6 spaces indent + 2 chars ("| ") = col 8 for 'where'
      expect(hostRange.start.col).toBe(8);
      expect(targetLine.substring(hostRange.start.col, hostRange.start.col + 5)).toBe('where');
    }
  });

  it('end-to-end linting on multi_query_rule.yaml extracts and lints each query independently', () => {
    const yamlText = fs.readFileSync(path.join(fixturesDir, 'multi_query_rule.yaml'), 'utf-8');
    const queries = extractQueries(yamlText, 'yaml', ['detectors.*.query'], false);

    expect(queries).toHaveLength(2);

    for (const q of queries) {
      const diags = linter.lint(q.rawText);
      expect(diags).toHaveLength(0); // both queries are valid PPL
    }
  });

  it('end-to-end linting on agent_config.toml with multiline string', () => {
    const tomlText = fs.readFileSync(path.join(fixturesDir, 'agent_config.toml'), 'utf-8');
    const queries = extractQueries(tomlText, 'toml', ['transforms.*.query'], false);

    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q.keyPath).toBe('transforms.filter_logs.query');

    const diags = linter.lint(q.rawText);
    expect(diags).toHaveLength(0); // valid PPL query
  });

  it('end-to-end linting on dashboard_saved_object.json', () => {
    const jsonText = fs.readFileSync(path.join(fixturesDir, 'dashboard_saved_object.json'), 'utf-8');
    const queries = extractQueries(jsonText, 'json', ['attributes.query'], false);

    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q.rawText).toBe('source=microservice_logs | where status >= 500 | stats count() by service_name');

    const diags = linter.lint(q.rawText);
    expect(diags).toHaveLength(0);
  });

  it('handles block scalar chomp indicators (|- and |+) accurately', () => {
    const yamlWithChomp = `rule:
  query: |-
    source=logs
    | stat count()
`;
    const queries = extractQueries(yamlWithChomp, 'yaml', ['rule.query'], false);
    expect(queries).toHaveLength(1);

    const diags = linter.lint(queries[0].rawText);
    const ppl003 = diags.find((d) => d.code === 'PPL003');
    expect(ppl003).toBeDefined();

    if (ppl003) {
      const hostRange = queries[0].sourceMap.translate(ppl003.span);
      expect(hostRange.start.line).toBe(3);
      expect(hostRange.start.col).toBe(6); // 4 spaces indent + 2 chars ("| ")
    }
  });
});
