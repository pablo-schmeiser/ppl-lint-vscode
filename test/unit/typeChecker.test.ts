import { describe, expect, it } from 'vitest';
import { PplLinter } from '../../src/core/linter';
import { parseIndexTemplates, resolveSource } from '../../src/core/indexTemplates';
import { parsePpl } from '../../src/core/parser/parser';
import { typedFieldScopeAt } from '../../src/core/schemaTypeChecker';
import { EvalStageNode, LookupStageNode } from '../../src/types';

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
        user:
          properties:
            name: { type: keyword }
        execve_command: { type: keyword }
`, 'auditd.yaml');

const lookupTemplates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: workers }
spec:
  indexPatterns: ['workers-*']
  template:
    aliases: { workers-reader: {} }
    mappings:
      properties:
        event:
          properties:
            type: { type: keyword }
        department: { type: keyword }
        city: { type: long }
        user: { type: keyword }
`, 'workers.yaml');

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

  it('restricts schema checks to configured index names and patterns', () => {
    const allowedQuery = 'source=auditd-2026 | where event.sequence > 0';
    const excludedQuery = 'source=other-2026 | where event.sequence > 0';
    const linter = new PplLinter({ openSearchVersion: '3.5', includedIndexes: ['auditd-*'] });

    expect(linter.lint(allowedQuery, templates).some((diagnostic) => diagnostic.code === 'PPL011')).toBe(false);
    const excluded = linter.lint(excludedQuery, templates);
    expect(excluded.filter((diagnostic) => diagnostic.code === 'PPL011')).toHaveLength(1);
    expect(excluded.find((diagnostic) => diagnostic.code === 'PPL011')?.message)
      .toContain('pplLinter.includedIndexes');
    expect(excluded.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
  });

  it('selects function signatures by PPL command context', () => {
    const invalid = 'source=auditd-reader | where sum(event.sequence, 1) > 0';
    const valid = 'source=auditd-reader | eval total = sum(1, 2)';
    const linter = new PplLinter({ openSearchVersion: '3.5' });

    expect(linter.lint(invalid, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(true);
    expect(linter.lint(valid, templates).some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('accepts uppercase NOT applied to boolean LIKE predicates', () => {
    const query = "source=auditd-reader | where NOT (execve_command LIKE '%--list%' OR execve_command LIKE '%-L%' OR execve_command LIKE '%--version%')";
    const ast = parsePpl(query);
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(ast.syntaxErrors).toHaveLength(0);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('validates documented statistical aggregation signatures', () => {
    const valid = 'source=auditd-reader | stats var_pop(event.sequence), var_samp(event.sequence), stddev_pop(event.sequence), stddev_samp(event.sequence), percentile(event.sequence, 90), percentile_approx(event.sequence, 90), median(event.sequence), list(event.type), take(event.type, 5)';
    const invalid = 'source=auditd-reader | stats var_pop(event.enabled), percentile(event.sequence), take(event.sequence, event.enabled)';
    const contextMismatch = 'source=auditd-reader | where var_pop(event.sequence) > 0';
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const validDiagnostics = linter.lint(valid, templates);
    const invalidSignatureDiagnostics = linter.lint(invalid, templates)
      .filter((diagnostic) => diagnostic.code === 'PPL014');
    const contextDiagnostics = linter.lint(contextMismatch, templates);

    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
    expect(invalidSignatureDiagnostics).toHaveLength(3);
    expect(contextDiagnostics.some((diagnostic) =>
      diagnostic.code === 'PPL014' && diagnostic.message.includes("not available in 'where' context")
    )).toBe(true);
  });

  it('validates documented string signatures including POSITION syntax', () => {
    const valid = "source=auditd-reader | eval cleaned = trim(event.type), joined = concat_ws('-', event.type, 'suffix'), part = substr(event.type, 1, 2), replaced = replace(event.type, 'a', 'b'), regex_replaced = regexp_replace(event.type, 'a', 'b'), matched = like(event.type, 'x%', true), insensitive = ilike(event.type, 'x%'), located = position('x' IN event.type)";
    const invalid = 'source=auditd-reader | eval bad_trim = trim(event.sequence), bad_substring = substring(event.type, event.enabled), bad_like = like(event.type, "x%", event.sequence), bad_replace = replace(event.type, "x")';
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const validDiagnostics = linter.lint(valid, templates);
    const invalidDiagnostics = linter.lint(invalid, templates)
      .filter((diagnostic) => diagnostic.code === 'PPL014');

    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
    expect(invalidDiagnostics).toHaveLength(4);
  });

  it('validates date signatures and recognizes parser-produced INTERVAL arguments', () => {
    const valid = "source=auditd-reader | eval parsed_date = date('2020-08-26'), next_date = adddate(date('2020-08-26'), 1), next_timestamp = date_add(now(), INTERVAL 1 DAY), prior_timestamp = date_sub(now(), INTERVAL 1 DAY), timestamp_value = timestamp(date('2020-08-26')), year_value = year(now()), month_value = month(now()), day_value = day(date('2020-08-26')), second_value = second(now()), extracted = extract(DAY FROM now()) | where year(next_timestamp) > 0 AND year(next_date) > 0";
    const invalid = 'source=auditd-reader | eval bad_year = year(event.enabled), bad_timestamp = timestamp(event.enabled), bad_extract = extract(DAY FROM event.enabled), bad_adddate = adddate(now())';
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const validDiagnostics = linter.lint(valid, templates);
    const invalidDiagnostics = linter.lint(invalid, templates)
      .filter((diagnostic) => diagnostic.code === 'PPL014');

    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
    expect(invalidDiagnostics).toHaveLength(4);
  });

  it('validates documented math and cryptographic signatures', () => {
    const valid = "source=auditd-reader | eval cube_root = cbrt(event.sequence), exponential = exp(event.sequence), natural_log = ln(event.sequence), natural_log_base = log(event.sequence), custom_log_base = log(2, event.sequence), decimal_log = log10(event.sequence), binary_log = log2(event.sequence), power_value = pow(event.sequence, 2), power_alias = power(event.sequence, 2), fallback = ifnull(event.type, 'unknown'), digest = md5(event.type), sha1_digest = sha1(event.type) | stats count(eval(event.enabled))";
    const invalid = 'source=auditd-reader | eval bad_exp = exp(event.enabled), bad_pow = pow(event.sequence), bad_ifnull = ifnull(event.type), bad_digest = md5(event.sequence)';
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const validDiagnostics = linter.lint(valid, templates);
    const invalidDiagnostics = linter.lint(invalid, templates)
      .filter((diagnostic) => diagnostic.code === 'PPL014');

    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
    expect(validDiagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
    expect(invalidDiagnostics).toHaveLength(4);
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

  it('resolves lookup aliases and patterns, defaults mapping fields, and propagates all non-key output types', () => {
    const allTemplates = [...templates, ...lookupTemplates];
    const aliasQuery = 'source=auditd-reader | lookup workers-reader event.type | where length(department) > 0 AND abs(city) > 0';
    const patternQuery = 'source=auditd-reader | lookup workers-* event.type as event.type replace department as team | where length(team) > 0';
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const aliasDiagnostics = linter.lint(aliasQuery, allTemplates);
    const patternDiagnostics = linter.lint(patternQuery, allTemplates);

    expect(aliasDiagnostics.some((diagnostic) => diagnostic.code === 'PPL011')).toBe(false);
    expect(aliasDiagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(aliasDiagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
    expect(patternDiagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(patternDiagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
  });

  it('treats lookup OUTPUT as REPLACE and aliases the selected lookup field', () => {
    const allTemplates = [...templates, ...lookupTemplates];
    const query = 'source=auditd-reader | lookup workers-reader user as user.name OUTPUT user as whitelisted_user | where isnull(whitelisted_user)';
    const ast = parsePpl(query);
    const lookup = ast.stages[0] as LookupStageNode;
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, allTemplates);

    expect(ast.syntaxErrors).toHaveLength(0);
    expect(lookup.outputMode).toBe('replace');
    expect(lookup.outputs).toMatchObject([
      { input: { name: 'user' }, output: { name: 'whitelisted_user' } },
    ]);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'PPL012')).toEqual([]);
  });

  it('validates lookup mapping fields and applies replace and append output semantics', () => {
    const allTemplates = [...templates, ...lookupTemplates];
    const appendExisting = 'source=auditd-reader | lookup workers-reader event.type append department as event.type | where length(event.type) > 0';
    const appendMissing = 'source=auditd-reader | lookup workers-reader event.type append department as team';
    const missingLookupKey = 'source=auditd-reader | lookup workers-reader missing_key as event.type';
    const missingSourceKey = 'source=auditd-reader | lookup workers-reader event.type as missing_source';
    const missingOutput = 'source=auditd-reader | lookup workers-reader event.type replace missing_output as team';
    const linter = new PplLinter({ openSearchVersion: '3.5' });

    expect(linter.lint(appendExisting, allTemplates).some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(linter.lint(appendMissing, allTemplates).some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes('must already exist')
    )).toBe(true);
    expect(linter.lint(missingLookupKey, allTemplates).some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes("'missing_key'")
    )).toBe(true);
    expect(linter.lint(missingSourceKey, allTemplates).some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes("'missing_source'")
    )).toBe(true);
    expect(linter.lint(missingOutput, allTemplates).some((diagnostic) =>
      diagnostic.code === 'PPL012' && diagnostic.message.includes("'missing_output'")
    )).toBe(true);
  });

  it('reports unresolved or excluded lookup indexes without cascading field errors', () => {
    const allTemplates = [...templates, ...lookupTemplates];
    const unresolved = 'source=auditd-reader | lookup missing-reader event.type replace department as team | where length(team) > 0';
    const excluded = 'source=auditd-reader | lookup workers-reader event.type replace department as team';
    const unresolvedDiagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(unresolved, allTemplates);
    const excludedDiagnostics = new PplLinter({ openSearchVersion: '3.5', includedIndexes: ['auditd-*'] }).lint(excluded, allTemplates);

    expect(unresolvedDiagnostics.filter((diagnostic) => diagnostic.code === 'PPL011')).toHaveLength(1);
    expect(unresolvedDiagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(excludedDiagnostics.some((diagnostic) =>
      diagnostic.code === 'PPL011' && diagnostic.message.includes('not included')
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

  it('types chained IF null-check flags as int and keeps them available to later stages', () => {
    const holidayTemplates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: holiday-events }
spec:
  indexPatterns: ['holiday-events-*']
  template:
    aliases: { holiday-events-reader: {} }
    mappings:
      properties:
        blacklisted_domain: { type: keyword }
        allowlisted_domain: { type: keyword }
        matched_ip: { type: keyword }
`, 'holiday-events.yaml');
    const query = 'source=holiday-events-reader | eval is_blacklisted = if(isnull(blacklisted_domain), 1, 0) | eval is_allowlisted = if(isnotnull(allowlisted_domain), 1, 0) | eval is_runner_match = if(isnotnull(matched_ip), 1, 0) | where is_allowlisted == 1';
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const diagnostics = linter.lint(query, holidayTemplates);
    const fields = typedFieldScopeAt(query, holidayTemplates, query.length);

    expect(fields?.get('is_blacklisted')?.pplTypes).toEqual(['int']);
    expect(fields?.get('is_allowlisted')?.pplTypes).toEqual(['int']);
    expect(fields?.get('is_runner_match')?.pplTypes).toEqual(['int']);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL014')).toBe(false);
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

  it('accepts time interval shorthand in streamstats span grouping', () => {
    const timeTemplates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: time-events }
spec:
  indexPatterns: ['time-events-*']
  template:
    aliases: { time-events-reader: {} }
    mappings:
      properties:
        '@timestamp': { type: date }
        user: { type: keyword }
`, 'time-events.yaml');
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    for (const interval of ['1ms', '1s', '1m', '1h', '1d', '1w', '1M', '1q', '1y']) {
      const query = `source=time-events-reader | streamstats count() as eventcount by user, span(@timestamp, ${interval})`;
      expect(linter.lint(query, timeTemplates), query).toEqual([]);
    }

    const invalidQuery = 'source=time-events-reader | streamstats count() as eventcount by user, span(@timestamp, missing_interval)';
    expect(linter.lint(invalidQuery, timeTemplates)).toContainEqual(expect.objectContaining({
      code: 'PPL012',
      message: expect.stringContaining("Field 'missing_interval'"),
    }));
  });

  it('propagates an aliased span grouping type into later stages', () => {
    const query = 'source=auditd-reader | stats count() by span(event.sequence, 10) as bucket | where abs(bucket) > 0';
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL012' && diagnostic.message.includes('bucket'))).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL014' && diagnostic.message.includes('abs'))).toBe(false);
  });
});
