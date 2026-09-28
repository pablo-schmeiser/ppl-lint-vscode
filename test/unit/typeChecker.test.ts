import { describe, expect, it } from 'vitest';
import { PplLinter } from '../../src/core/linter';
import { parseIndexTemplates, resolveSource } from '../../src/core/indexTemplates';
import { parsePpl } from '../../src/core/parser/parser';
import { EvalStageNode } from '../../src/types';

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: auditd }
spec:
  indexPatterns: ['auditd-*']
  template:
    aliases: { auditd-reader: {} }
    mappings:
      dynamic: false
      properties:
        event:
          properties:
            type: { type: keyword }
            sequence: { type: long }
            enabled: { type: boolean }
`, 'auditd.yaml');

describe('schema-aware PPL type checking', () => {
  it('reports an undeclared field at its identifier while keeping schema-free linting unchanged', () => {
    const query = 'source=auditd-reader | where event.missing == 1';
    const linter = new PplLinter({ openSearchVersion: '3.5' });

    const diagnostics = linter.lint(query, templates);
    const missingField = diagnostics.find((diagnostic) => diagnostic.code === 'PPL012');
    const start = query.indexOf('event.missing');

    expect(missingField).toMatchObject({ severity: 'error' });
    expect(missingField?.span.start.offset).toBe(start);
    expect(missingField?.span.end.offset).toBe(start + 'event.missing'.length);
    expect(linter.lint(query).some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
  });

  it('reports an unmatched source once without cascading field errors when schema checking is enabled', () => {
    const query = 'source=unknown-index | where missing.field == 1';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, [], true);

    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'PPL011')).toHaveLength(1);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
  });

  it('selects function signatures by PPL command context', () => {
    const invalid = 'source=auditd-reader | where sum(event.sequence, 1) > 0';
    const valid = 'source=auditd-reader | eval total = sum(1, 2)';
    const linter = new PplLinter({ openSearchVersion: '3.5' });

    expect(linter.lint(invalid, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(true);
    expect(linter.lint(valid, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('warns for implicit string-to-number conversions in comparisons and arithmetic', () => {
    const comparison = 'source=auditd-reader | where event.type > 1';
    const arithmetic = 'source=auditd-reader | eval numeric = event.type - 1';
    const linter = new PplLinter({ openSearchVersion: '3.5' });

    expect(linter.lint(comparison, templates).filter((diagnostic) => diagnostic.code === 'PPL015')).toHaveLength(1);
    expect(linter.lint(arithmetic, templates).filter((diagnostic) => diagnostic.code === 'PPL015')).toHaveLength(1);
    expect(linter.lint(arithmetic, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('errors on used dynamic children but accepts statically declared children', () => {
    const dynamicTemplate = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: dynamic-logs }
spec:
  indexPatterns: ['dynamic-logs-*']
  template:
    aliases: { dynamic-logs-reader: {} }
    mappings:
      dynamic: false
      properties:
        attributes:
          type: object
          dynamic: true
          properties:
            category: { type: keyword }
`, 'dynamic-logs.yaml');
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const dynamicUse = "source=dynamic-logs-reader | where attributes.runtime_key == 'value'";
    const declaredUse = "source=dynamic-logs-reader | where attributes.category == 'value'";

    expect(linter.lint(dynamicUse, dynamicTemplate).some((diagnostic) => diagnostic.code === 'PPL012')).toBe(true);
    expect(linter.lint(declaredUse, dynamicTemplate).some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
  });

  it('merges equivalent PPL types and reports conflicting field types only when used', () => {
    const secondTemplate = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: auditd-secondary }
spec:
  indexPatterns: ['auditd-secondary-*']
  template:
    aliases: { auditd-reader: {} }
    mappings:
      dynamic: false
      properties:
        event:
          properties:
            type: { type: text }
            sequence: { type: integer }
`, 'auditd-secondary.yaml');
    const aliasTemplates = [...templates, ...secondTemplate];
    const fields = resolveSource(aliasTemplates, 'auditd-reader');
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const conflictQuery = 'source=auditd-reader | where event.sequence > 0';
    const conflict = linter.lint(conflictQuery, aliasTemplates).find((diagnostic) => diagnostic.code === 'PPL013');
    const fieldStart = conflictQuery.indexOf('event.sequence');
    const unusedConflict = linter.lint(
      "source=auditd-reader | where event.type == 'login'",
      aliasTemplates
    );

    expect(fields.get('event.type')?.pplTypes).toEqual(['string']);
    expect(fields.get('event.sequence')?.pplTypes).toEqual(['bigint', 'int']);
    expect(conflict?.span.start.offset).toBe(fieldStart);
    expect(conflict?.message).toContain('bigint, int');
    expect(unusedConflict.some((diagnostic) => diagnostic.code === 'PPL013')).toBe(false);
  });

  it('parses CAST(expr AS type) as a typed expression node', () => {
    const ast = parsePpl('source=auditd-reader | eval sequence_text = CAST(event.sequence AS STRING)');
    const evalStage = ast.stages[0] as EvalStageNode;

    expect(ast.syntaxErrors).toHaveLength(0);
    expect(evalStage.assignments[0].value).toMatchObject({
      type: 'CastExpression',
      targetType: 'string',
    });
  });

  it('rejects invalid cast targets and incompatible arithmetic operands', () => {
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const castQuery = "source=auditd-reader | eval bad = CAST(event.sequence AS madeup)";
    const arithmeticQuery = 'source=auditd-reader | eval bad = event.enabled + 1';

    expect(linter.lint(castQuery, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(true);
    expect(linter.lint(arithmeticQuery, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(true);
  });

  it('checks function argument types using normalized PPL field types', () => {
    const invalid = 'source=auditd-reader | where abs(event.enabled) > 1';
    const valid = 'source=auditd-reader | where abs(event.sequence) > 1';
    const coercion = 'source=auditd-reader | where abs(event.type) > 1';
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const mismatch = linter.lint(invalid, templates).find((diagnostic) => diagnostic.code === 'PPL014');
    const warning = linter.lint(coercion, templates).find((diagnostic) => diagnostic.code === 'PPL015');

    expect(mismatch?.severity).toBe('error');
    expect(invalid.slice(mismatch!.span.start.offset, mismatch!.span.end.offset)).toBe('event.enabled');
    expect(warning?.severity).toBe('warning');
    const evalCoercion = linter.lint('source=auditd-reader | eval numeric = abs(event.type)', templates);
    expect(evalCoercion.filter((diagnostic) => diagnostic.code === 'PPL015')).toHaveLength(1);
    expect(linter.lint(valid, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('propagates CAST and function result types through eval stages', () => {
    const query = 'source=auditd-reader | eval textual = CAST(event.sequence AS STRING), magnitude = abs(event.sequence) | where length(textual) > 0 AND abs(magnitude) > 0';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('collapses stats scope but preserves input fields through streamstats', () => {
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const statsQuery = 'source=auditd-reader | stats sum(event.sequence) as total by event.type | where event.sequence > 0';
    const streamstatsQuery = 'source=auditd-reader | streamstats count() as total by event.type | where event.sequence > 0 AND total > 0';

    expect(linter.lint(statsQuery, templates).some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes("'event.sequence'")
    )).toBe(true);
    expect(linter.lint(streamstatsQuery, templates).some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
  });

  it('treats lookup output fields as untyped until lookup schemas are added', () => {
    const query = "source=auditd-reader | lookup users o as event.type replace fullName | where fullName == 'Alice'";
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes("'fullName'")
    )).toBe(true);

    const outputQuery = "source=auditd-reader | lookup users id as event.type OUTPUT fullName | where fullName == 'Alice'";
    const outputDiagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(outputQuery, templates);
    expect(outputDiagnostics.some((diagnostic) => diagnostic.code === 'PPL001')).toBe(false);
    expect(outputDiagnostics.some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes("'fullName'")
    )).toBe(true);
  });

  it('projects available fields through table instead of making later scope uncertain', () => {
    const query = 'source=auditd-reader | table event.type | where event.sequence > 0';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes("'event.sequence'")
    )).toBe(true);
  });

  it('infers return types for common date functions and treats date-part arguments as constants', () => {
    const query = 'source=auditd-reader | eval day = dayname(now()), next = timestampadd(DAY, 1, now()) | where length(day) > 0 AND hour(next) > 0';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('infers a common result type for CASE branches', () => {
    const query = "source=auditd-reader | eval label = case(event.enabled, 'enabled', event.type == 'login' else 'other') | where length(label) > 0";
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
  });

  it('recognizes match_phrase with string arguments and a boolean result', () => {
    const query = "source=auditd-reader | where match_phrase(event.type, 'login')";
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('types named rex captures as strings for following stages', () => {
    const query = 'source=auditd-reader | rex field=event.type "(?<login>\\w+)" | where abs(login) > 0';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'PPL015')).toHaveLength(1);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012' && diagnostic.message.includes('login'))).toBe(false);
  });

  it('checks source fields inside stats grouping expressions', () => {
    const query = 'source=auditd-reader | stats count() by span(event.missing, 10)';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012' && diagnostic.message.includes('event.missing'))).toBe(true);
  });

  it('propagates an aliased span grouping type into later stages', () => {
    const query = 'source=auditd-reader | stats count() by span(event.sequence, 10) as bucket | where abs(bucket) > 0';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012' && diagnostic.message.includes('bucket'))).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL014' && diagnostic.message.includes('abs'))).toBe(false);
  });
});