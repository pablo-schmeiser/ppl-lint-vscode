import { describe, expect, it } from 'vitest';
import { PplLinter } from '../../src/core/linter';
import { findClosestMatch, levenshtein } from '../../src/core/rules/rule';

describe('Levenshtein string matching helper', () => {
  it('computes edit distance accurately', () => {
    expect(levenshtein('stats', 'stat')).toBe(1);
    expect(levenshtein('where', 'wehre')).toBe(2);
    expect(levenshtein('fields', 'fieds')).toBe(1);
    expect(levenshtein('count', 'count')).toBe(0);
  });

  it('finds closest command candidates', () => {
    const candidates = ['where', 'fields', 'stats', 'eval', 'sort', 'dedup'];
    expect(findClosestMatch('stat', candidates)).toBe('stats');
    expect(findClosestMatch('wehre', candidates)).toBe('where');
    expect(findClosestMatch('filds', candidates)).toBe('fields');
  });
});

describe('Diagnostic Rules Catalog (PPL001 - PPL007)', () => {
  const linter = new PplLinter();

  it('PPL001: reports syntax errors', () => {
    const query = 'source=logs | where (status == 200';
    const diagnostics = linter.lint(query);

    const ppl001 = diagnostics.filter((d) => d.code === 'PPL001');
    expect(ppl001.length).toBeGreaterThan(0);
    expect(ppl001[0].severity).toBe('error');
  });

  it('PPL001: reports unclosed string literal and unclosed backtick identifier', () => {
    const queryStr = "source=logs | where name = 'unclosed";
    const diagsStr = linter.lint(queryStr);
    const ppl001Str = diagsStr.find(
      (d) => d.code === 'PPL001' && d.message.includes('Unclosed string literal')
    );
    expect(ppl001Str).toBeDefined();
    expect(ppl001Str?.severity).toBe('error');

    const queryIdent = 'source=logs | where `unclosed_col == 1';
    const diagsIdent = linter.lint(queryIdent);
    const ppl001Ident = diagsIdent.find(
      (d) => d.code === 'PPL001' && d.message.includes('Unclosed identifier')
    );
    expect(ppl001Ident).toBeDefined();
    expect(ppl001Ident?.severity).toBe('error');
  });

  it('PPL002: reports missing source command and provides quick-fix suggestion', () => {
    const query = 'where age > 30';
    const diagnostics = linter.lint(query);

    const ppl002 = diagnostics.find((d) => d.code === 'PPL002');
    expect(ppl002).toBeDefined();
    expect(ppl002?.severity).toBe('error');
    expect(ppl002?.data?.suggestion).toBe('source=');
  });

  it('PPL003: reports unknown command and suggests closest match', () => {
    const query = 'source=logs | stat count()';
    const diagnostics = linter.lint(query);

    const ppl003 = diagnostics.find((d) => d.code === 'PPL003');
    expect(ppl003).toBeDefined();
    expect(ppl003?.severity).toBe('error');
    expect(ppl003?.message).toContain("Did you mean 'stats'?");
    expect(ppl003?.data?.suggestion).toBe('stats');
  });

  it('PPL004: reports invalid arguments for standard commands', () => {
    const query = 'source=logs | sort';
    const diagnostics = linter.lint(query);

    const ppl004 = diagnostics.find((d) => d.code === 'PPL004');
    expect(ppl004).toBeDefined();
    expect(ppl004?.severity).toBe('error');
    expect(ppl004?.message).toContain("'sort' command requires at least one sort field");
  });

  it('PPL005: reports unknown function in expression/aggregation', () => {
    const query = 'source=logs | stats unknow_func(bytes)';
    const diagnostics = linter.lint(query);

    const ppl005 = diagnostics.find((d) => d.code === 'PPL005');
    expect(ppl005).toBeDefined();
    expect(ppl005?.severity).toBe('warning');
    expect(ppl005?.message).toContain("Unknown function 'unknow_func'");
  });

  it('PPL006: warns when filter is placed after heavy operations (sort/stats/dedup)', () => {
    const query = 'source=logs | sort bytes | where status == 200';
    const diagnostics = linter.lint(query);

    const ppl006 = diagnostics.find((d) => d.code === 'PPL006');
    expect(ppl006).toBeDefined();
    expect(ppl006?.severity).toBe('warning');
    expect(ppl006?.message).toContain("placed after heavy command 'sort'");
  });

  it('PPL007: warns on assignment operator in boolean condition with fix suggestion', () => {
    const query = 'source=logs | where status = 200';
    const diagnostics = linter.lint(query);

    const ppl007 = diagnostics.find((d) => d.code === 'PPL007');
    expect(ppl007).toBeDefined();
    expect(ppl007?.severity).toBe('warning');
    expect(ppl007?.data?.suggestion).toBe('==');
  });

  it('supports configurable severity levels and disabling rules (off)', () => {
    const customLinter = new PplLinter({
      rules: {
        PPL007: 'off',
        PPL006: 'info',
      },
    });

    const query = 'source=logs | sort bytes | where status = 200';
    const diagnostics = customLinter.lint(query);

    expect(diagnostics.some((d) => d.code === 'PPL007')).toBe(false);

    const ppl006 = diagnostics.find((d) => d.code === 'PPL006');
    expect(ppl006).toBeDefined();
    expect(ppl006?.severity).toBe('info');
  });

  it('PPL003: supports user-defined customCommands and typo matching', () => {
    const query = 'source=logs | trendline count()';
    const defaultDiags = linter.lint(query);
    const defaultPpl003 = defaultDiags.find((d) => d.code === 'PPL003');
    expect(defaultPpl003).toBeDefined();
    expect(defaultPpl003?.message).toContain("Unknown command 'trendline'");

    const customLinter = new PplLinter({
      customCommands: ['trendline', 'lookup'],
    });
    const customDiags = customLinter.lint(query);
    expect(customDiags.some((d) => d.code === 'PPL003')).toBe(false);

    // Typo matching with custom command
    const typoQuery = 'source=logs | trendlin count()';
    const typoDiags = customLinter.lint(typoQuery);
    const typoPpl003 = typoDiags.find((d) => d.code === 'PPL003');
    expect(typoPpl003).toBeDefined();
    expect(typoPpl003?.message).toContain("Did you mean 'trendline'?");
    expect(typoPpl003?.data?.suggestion).toBe('trendline');
  });

  it('PPL005: supports user-defined customFunctions and typo matching', () => {
    const query = 'source=logs | stats custom_score(bytes)';
    const defaultDiags = linter.lint(query);
    const defaultPpl005 = defaultDiags.find((d) => d.code === 'PPL005');
    expect(defaultPpl005).toBeDefined();
    expect(defaultPpl005?.message).toContain("Unknown function 'custom_score'");

    const customLinter = new PplLinter({
      customFunctions: ['custom_score', 'udf_hash'],
    });
    const customDiags = customLinter.lint(query);
    expect(customDiags.some((d) => d.code === 'PPL005')).toBe(false);

    // Typo matching with custom function
    const typoQuery = 'source=logs | stats custom_scor(bytes)';
    const typoDiags = customLinter.lint(typoQuery);
    const typoPpl005 = typoDiags.find((d) => d.code === 'PPL005');
    expect(typoPpl005).toBeDefined();
    expect(typoPpl005?.message).toContain("Did you mean 'custom_score'?");
    expect(typoPpl005?.data?.suggestion).toBe('custom_score');
  });
});

