import { describe, expect, it } from 'vitest';
import { completionCandidates } from '../../src/core/completion';
import { parseIndexTemplates } from '../../src/core/indexTemplates';
import { PPL_TYPES } from '../../src/core/pplTypes';

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: test-audit }
spec:
  indexPatterns: ['test-audit-*']
  template:
    aliases: { test-reader: {} }
    mappings:
      properties:
        host:
          properties:
            name: { type: keyword }
        pid: { type: long }
`, 'template.yaml');

const lookupTemplates = [...templates, ...parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: test_workers }
spec:
  indexPatterns: ['test_workers-*']
  template:
    aliases: { test_workers-reader: {} }
    mappings:
      properties:
        employee_id: { type: keyword }
        department: { type: keyword }
`, 'test_workers.yaml')];

const overlappingTemplates = [...lookupTemplates, ...parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: test_workers-extra }
spec:
  indexPatterns: ['test_workers-*']
  template:
    aliases: { test_workers-reader: {} }
    mappings:
      properties:
        pid: { type: keyword }
`, 'test_workers-extra.yaml')];

describe('completion candidates', () => {
  it('suggests integer fields for integer arguments and numeric or string fields for mixed arguments', () => {
    const integerQuery = 'source=test-reader | eval value = rand(';
    const integerFields = completionCandidates(integerQuery, integerQuery.length, templates).filter(({ kind }) => kind === 'field');
    expect(integerFields.map(({ label }) => label)).toEqual(['pid']);
    const mixedQuery = 'source=test-reader | eval value = max(';
    const mixedFields = completionCandidates(mixedQuery, mixedQuery.length, templates).filter(({ kind }) => kind === 'field');
    expect(mixedFields.map(({ label }) => label).sort()).toEqual(['host.name', 'pid']);
  });

  it('suggests temporal type constants for get_format instead of interval units', () => {
    const query = 'source=test-reader | eval value = get_format(';
    expect(completionCandidates(query, query.length, templates).map(({ label }) => label).sort())
      .toEqual(['DATE', 'TIME', 'TIMESTAMP']);
  });

  it('suggests configured lookup indexes by prefix', () => {
    const query = 'source=test-reader | lookup test_wor';
    expect(completionCandidates(query, query.length, lookupTemplates)
      .some((candidate) => candidate.label === 'test_workers-reader' && candidate.kind === 'source')).toBe(true);
  });

  it('completes lookup keys and output fields from the lookup index', () => {
    for (const clause of ['lookup test_workers-reader emp', 'lookup test_workers-reader employee_id, dep',
      'lookup test_workers-reader employee_id replace dep', 'lookup test_workers-reader employee_id output dep']) {
      const query = `source=test-reader | ${clause}`;
      const candidates = completionCandidates(query, query.length, lookupTemplates);
      expect(candidates.some((candidate) => candidate.label === (clause.endsWith('emp') ? 'employee_id' : 'department') &&
        candidate.kind === 'field'), clause).toBe(true);
      expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field'), clause).toBe(false);
    }
  });

  it('completes lookup mapping and append aliases from source fields but not replace aliases', () => {
    for (const clause of ['lookup test_workers-reader employee_id as pi',
      'lookup test_workers-reader employee_id append department as pi']) {
      const query = `source=test-reader | ${clause}`;
      const candidates = completionCandidates(query, query.length, lookupTemplates);
      expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field'), clause).toBe(true);
      expect(candidates.some((candidate) => candidate.label === 'department' && candidate.kind === 'field'), clause).toBe(false);
    }
    const alias = 'source=test-reader | lookup test_workers-reader employee_id replace department as ';
    expect(completionCandidates(alias, alias.length, lookupTemplates)).toEqual([]);
  });

  it('respects index allowlists for lookup schemas and source fields', () => {
    const index = 'source=test-reader | lookup test_wor';
    expect(completionCandidates(index, index.length, lookupTemplates, ['test-reader'])).toEqual([]);
    const key = 'source=test-reader | lookup test_workers-reader emp';
    expect(completionCandidates(key, key.length, lookupTemplates, ['test-reader'])
      .some((candidate) => candidate.kind === 'field')).toBe(false);
  });

  it('offers lookup mapping and output-mode keywords at the right boundary', () => {
    const key = 'source=test-reader | lookup test_workers-reader employee_id ';
    expect(completionCandidates(key, key.length, lookupTemplates).map((candidate) => candidate.label))
      .toEqual(['as', 'replace', 'append', 'output']);
    const mapped = 'source=test-reader | lookup test_workers-reader employee_id as pid rep';
    expect(completionCandidates(mapped, mapped.length, lookupTemplates).map((candidate) => candidate.label))
      .toEqual(['replace']);
  });

  it('offers lookup output fields in downstream stages', () => {
    for (const [lookup, expected, absent] of [
      ['lookup test_workers-reader employee_id as pid', 'department', 'employee_id'],
      ['lookup test_workers-reader employee_id as pid replace department as team', 'team', 'department'],
    ]) {
      const query = `source=test-reader | ${lookup} | where `;
      const fields = completionCandidates(query, query.length, lookupTemplates)
        .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
      expect(fields, lookup).toContain(expected);
      expect(fields, lookup).not.toContain(absent);
      expect(fields, lookup).toContain('pid');
    }
    const append = 'source=test-reader | lookup test_workers-reader employee_id as pid append department as new_field | where ';
    expect(completionCandidates(append, append.length, lookupTemplates)
      .some((candidate) => candidate.label === 'new_field' && candidate.kind === 'field')).toBe(false);
  });

  it('completes join field lists from the input and join datasets from configured sources', () => {
    const key = 'source=test-reader | join pi';
    const keys = completionCandidates(key, key.length, lookupTemplates);
    expect(keys.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
    expect(keys.some((candidate) => candidate.label === 'employee_id' && candidate.kind === 'field')).toBe(false);
    const dataset = 'source=test-reader | join pid test_wor';
    expect(completionCandidates(dataset, dataset.length, lookupTemplates)
      .some((candidate) => candidate.label === 'test_workers-reader' && candidate.kind === 'source')).toBe(true);
    const finished = 'source=test-reader | join pid test_workers-reader ';
    expect(completionCandidates(finished, finished.length, lookupTemplates)).toEqual([]);
  });

  it('completes aliased join criteria from the correct side', () => {
    const query = 'source=test-reader | join left=l right=r on l.pi = r.emp test_workers-reader';
    const left = completionCandidates(query, query.indexOf('l.pi') + 'l.pi'.length, lookupTemplates);
    expect(left.some((candidate) => candidate.label === 'l.pid' && candidate.kind === 'field')).toBe(true);
    expect(left.some((candidate) => candidate.label === 'l.employee_id')).toBe(false);
    const right = completionCandidates(query, query.indexOf('r.emp') + 'r.emp'.length, lookupTemplates);
    expect(right.some((candidate) => candidate.label === 'r.employee_id' && candidate.kind === 'field')).toBe(true);
    expect(right.some((candidate) => candidate.label === 'r.pid')).toBe(false);
  });

  it('completes scalar function arguments and continuations in join criteria', () => {
    const argument = 'source=test-reader | join on lower(';
    const argumentFields = completionCandidates(argument, argument.length, lookupTemplates);
    expect(argumentFields.some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field')).toBe(true);
    expect(argumentFields.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(false);
    const query = 'source=test-reader | join left=l right=r on lower(l.ho) = r.department test_workers-reader';
    const candidates = completionCandidates(query, query.indexOf('l.ho') + 'l.ho'.length, lookupTemplates);
    expect(candidates.some((candidate) => candidate.label === 'l.host.name' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'l.pid' && candidate.kind === 'field')).toBe(false);
    const nested = 'source=test-reader | join on low';
    expect(completionCandidates(nested, nested.length, lookupTemplates)
      .some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
    const complete = 'source=test-reader | join left=l right=r on l.pid = r.employee_id ';
    const labels = completionCandidates(complete, complete.length, lookupTemplates).map((candidate) => candidate.label);
    expect(labels).toContain('AND');
    expect(labels).toContain('OR');
  });

  it('completes nested join queries against their own source', () => {
    const query = 'source=test-reader | join left=l right=r [source=test_workers-reader | where dep';
    const candidates = completionCandidates(query, query.length, lookupTemplates);
    expect(candidates.some((candidate) => candidate.label === 'department' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(false);
    const source = 'source=test-reader | join pid [source=test_wor';
    expect(completionCandidates(source, source.length, lookupTemplates)
      .some((candidate) => candidate.label === 'test_workers-reader' && candidate.kind === 'source')).toBe(true);
  });

  it('offers a join dataset after a completed criterion and its fields in earlier criteria', () => {
    const dataset = 'source=test-reader | join left=l right=r on l.pid = r.employee_id test_wor';
    expect(completionCandidates(dataset, dataset.length, lookupTemplates)
      .some((candidate) => candidate.label === 'test_workers-reader' && candidate.kind === 'source')).toBe(true);
    const subquery = 'source=test-reader | join left=l right=r on r.emp [source=test_workers-reader | head 1]';
    expect(completionCandidates(subquery, subquery.indexOf('r.emp') + 'r.emp'.length, lookupTemplates)
      .some((candidate) => candidate.label === 'r.employee_id' && candidate.kind === 'field')).toBe(true);
    const finished = 'source=test-reader | join on pid = employee_id test_workers-reader ';
    const afterDataset = completionCandidates(finished, finished.length, lookupTemplates);
    expect(afterDataset.some((candidate) => ['AND', 'OR', 'test_workers-reader'].includes(candidate.label))).toBe(false);
  });

  it('uses fields output by a join subquery and the active join in a pipeline', () => {
    const transformed = 'source=test-reader | join left=l right=r on r.te [source=test_workers-reader | rename department as team]';
    const candidates = completionCandidates(transformed, transformed.indexOf('r.te') + 'r.te'.length, lookupTemplates);
    expect(candidates.some((candidate) => candidate.label === 'r.team' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'r.department')).toBe(false);
    const successive = 'source=test-reader | join pid test_workers-reader | join left=a right=b on b.emp test_workers-reader';
    expect(completionCandidates(successive, successive.indexOf('b.emp') + 'b.emp'.length, lookupTemplates)
      .some((candidate) => candidate.label === 'b.employee_id' && candidate.kind === 'field')).toBe(true);
  });

  it('completes join type and overwrite options without filling free aliases', () => {
    const name = 'source=test-reader | join ty';
    expect(completionCandidates(name, name.length, lookupTemplates).map((candidate) => candidate.label)).toContain('type');
    const next = 'source=test-reader | join left=l ri';
    expect(completionCandidates(next, next.length, lookupTemplates).map((candidate) => candidate.label)).toContain('right');
    const type = 'source=test-reader | join type=ou';
    expect(completionCandidates(type, type.length, lookupTemplates).map((candidate) => candidate.label)).toContain('outer');
    const semi = 'source=test-reader | join type=se';
    expect(completionCandidates(semi, semi.length, lookupTemplates).map((candidate) => candidate.label)).toContain('semi');
    const overwrite = 'source=test-reader | join overwrite=tr';
    expect(completionCandidates(overwrite, overwrite.length, lookupTemplates).map((candidate) => candidate.label)).toEqual(['true']);
    const alias = 'source=test-reader | join left=';
    expect(completionCandidates(alias, alias.length, lookupTemplates)).toEqual([]);
  });

  it('offers right-side output fields after joins except semi and anti joins', () => {
    for (const join of [
      'join on pid = employee_id test_workers-reader',
      'join pid [source=test_workers-reader | rename department as team]',
    ]) {
      const query = `source=test-reader | ${join} | where `;
      const names = completionCandidates(query, query.length, lookupTemplates)
        .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
      expect(names, join).toContain(join.includes('rename') ? 'team' : 'department');
      expect(names, join).toContain('pid');
    }
    for (const join of [
      'left semi join left=l right=r on l.pid = r.employee_id test_workers-reader',
      'join type=anti on pid = employee_id test_workers-reader',
    ]) {
      const query = `source=test-reader | ${join} | where `;
      expect(completionCandidates(query, query.length, lookupTemplates)
        .some((candidate) => candidate.label === 'department' && candidate.kind === 'field'), join).toBe(false);
    }
  });

  it('qualifies colliding basic join fields and honors field-list overwrite', () => {
    const basic = 'source=test-reader | join left=l right=r on l.pid = r.pid test_workers-reader | where ';
    const names = completionCandidates(basic, basic.length, overlappingTemplates)
      .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
    expect(names).toContain('l.pid');
    expect(names).toContain('r.pid');
    expect(names).not.toContain('pid');
    expect(names).toContain('department');

    const keep = 'source=test-reader | join overwrite=false pid test_workers-reader | where pid';
    const replace = 'source=test-reader | join overwrite=true pid test_workers-reader | where pid';
    expect(completionCandidates(keep, keep.length, overlappingTemplates).find((candidate) => candidate.label === 'pid')?.detail)
      .toContain('bigint');
    expect(completionCandidates(replace, replace.length, overlappingTemplates).find((candidate) => candidate.label === 'pid')?.detail)
      .toContain('string');
    const datasetAlias = 'source=test-reader | join on pid = pid [source=test_workers-reader] as w | where ';
    const aliasedNames = completionCandidates(datasetAlias, datasetAlias.length, overlappingTemplates)
      .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
    expect(aliasedNames).toContain('w.pid');
    expect(aliasedNames).not.toContain('test_workers-reader.pid');
    const aliasedCriterion = 'source=test-reader | join on w.pi [source=test_workers-reader] as w';
    expect(completionCandidates(aliasedCriterion, aliasedCriterion.indexOf('w.pi') + 'w.pi'.length, overlappingTemplates)
      .some((candidate) => candidate.label === 'w.pid' && candidate.kind === 'field')).toBe(true);
  });

  it('offers aliases at source and fields visible at the current stage', () => {
    const source = 'source=test-r';
    expect(completionCandidates(source, source.length, templates).map((item) => item.label)).toContain('test-reader');
    const input = 'source=test-reader | stats count(pid) as total by host.name';
    expect(completionCandidates(input, input.indexOf('pid'), templates).map((item) => item.label)).toContain('pid');
    const output = `${input} | where `;
    expect(completionCandidates(output, output.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label)).toEqual(['total', 'host.name']);
  });

  it('offers every input field in fields projections, including after commas', () => {
    const emptyProjection = 'source=test-reader | fields ';
    const allFields = completionCandidates(emptyProjection, emptyProjection.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label);
    expect(allFields).toContain('host.name');
    expect(allFields).toContain('pid');

    const partialProjection = `${emptyProjection}host.name, `;
    const remaining = completionCandidates(partialProjection, partialProjection.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label);
    expect(remaining).toContain('pid');
  });

  it('only excludes fields selected in the current fields stage', () => {
    const query = 'source=test-reader | where pid > 0 | fields host.name, ';
    const labels = completionCandidates(query, query.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label);
    expect(labels).toContain('pid');
    expect(labels).not.toContain('host.name');
  });

  it('suggests fields in field-taking command positions', () => {
    for (const command of ['top 5 ho', 'rare 5 ho', 'grok ho', 'patterns ho', 'parse ho', 'regex ho', 'bin ho', 'rex field=ho']) {
      const query = `source=test-reader | ${command}`;
      expect(completionCandidates(query, query.length, templates)
        .some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field'), command).toBe(true);
    }
  });

  it('does not suggest fields after single-field command operands', () => {
    for (const command of ['grok host.name ', 'patterns host.name ', 'parse host.name ', 'regex host.name=', 'bin host.name span=']) {
      const query = `source=test-reader | ${command}`;
      expect(completionCandidates(query, query.length, templates)
        .some((candidate) => candidate.kind === 'field'), command).toBe(false);
    }
  });

  it('keeps schema fields unavailable without templates but still suggests built-ins', () => {
    const query = 'source=test-missing | where ';
    const candidates = completionCandidates(query, query.length, []);
    expect(candidates.some((candidate) => candidate.kind === 'field')).toBe(false);
    expect(candidates.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
  });

  it('limits source and field suggestions to the configured index allowlist', () => {
    const source = 'source=test-r';
    const sourceCandidates = completionCandidates(source, source.length, templates, ['test-reader']);
    expect(sourceCandidates.map((candidate) => candidate.label)).toEqual(['test-reader']);

    const query = 'source=test-other-index | where ';
    const fieldCandidates = completionCandidates(query, query.length, templates, ['test-audit-*']);
    expect(fieldCandidates.some((candidate) => candidate.kind === 'field')).toBe(false);
    expect(fieldCandidates.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
  });

  it('suggests functions without loading index templates', () => {
    const query = 'source=test-missing | eval label = lo';
    const candidates = completionCandidates(query, query.length, []);
    const lower = candidates.find((candidate) => candidate.label === 'lower' && candidate.kind === 'function');
    expect(lower?.detail).toBe('lower(string)');
    expect(lower?.documentation).toContain('Converts a string to lowercase.');
    expect(lower?.documentation).toContain('OpenSearch PPL reference');
  });

  it('suggests pipeline commands after a pipe and aggregations after stats', () => {
    const afterPipe = 'source=test-reader | ';
    const commands = completionCandidates(afterPipe, afterPipe.length, templates);
    expect(commands.find((candidate) => candidate.label === 'stats' && candidate.kind === 'command')?.retriggerAfterAccept).toBe(true);

    const stats = 'source=test-reader | stats ';
    const aggregations = completionCandidates(stats, stats.length, templates);
    expect(aggregations.find((candidate) => candidate.label === 'count' && candidate.kind === 'function')?.retriggerAfterAccept).toBe(true);
    expect(aggregations.some((candidate) => candidate.label === 'sum' && candidate.kind === 'function')).toBe(true);
    expect(aggregations.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(false);
    expect(aggregations.some((candidate) => candidate.kind === 'field')).toBe(false);
  });

  it('keeps input fields available in an unfinished stats grouping clause', () => {
    const query = 'source=test-reader | stats count() by ';
    const candidates = completionCandidates(query, query.length, templates);
    expect(candidates.some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'count' && candidate.kind === 'function')).toBe(false);
    expect(candidates.some((candidate) => candidate.label === 'span' && candidate.kind === 'function')).toBe(true);
  });

  it('suggests scalar functions inside aggregation arguments, not nested aggregates', () => {
    for (const command of ['stats', 'eventstats', 'streamstats', 'timechart']) {
      const query = `source=test-reader | ${command} sum(ab`;
      const candidates = completionCandidates(query, query.length, templates);
      expect(candidates.some((candidate) => candidate.label === 'abs' && candidate.kind === 'function')).toBe(true);
      expect(candidates.some((candidate) => candidate.label === 'avg' && candidate.kind === 'function')).toBe(false);
    }
  });

  it('suggests fields but no aggregate functions after timechart by', () => {
    const query = 'source=test-reader | timechart count() by ';
    const candidates = completionCandidates(query, query.length, templates);
    expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'function')).toBe(false);
  });

  it('does not suggest aggregate functions in timechart option values', () => {
    for (const command of ['timechart span=', 'streamstats window=', 'stats bucket_nullable=']) {
      const query = `source=test-reader | ${command}`;
      expect(completionCandidates(query, query.length, templates).some((candidate) => candidate.kind === 'function'), command).toBe(false);
    }
    const timefield = 'source=test-reader | timechart timefield=ho';
    expect(completionCandidates(timefield, timefield.length, templates)
      .some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field')).toBe(true);
    const reset = 'source=test-reader | streamstats reset_before=pi';
    expect(completionCandidates(reset, reset.length, templates)
      .some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
  });

  it('does not suggest computed fields from an unfinished earlier assignment', () => {
    const query = 'source=test-reader | eval size = | stats sum(';
    const fields = completionCandidates(query, query.length, templates)
      .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
    expect(fields).toContain('pid');
    expect(fields).not.toContain('size');
  });

  it('suggests logical and pipeline continuations after a where comparison', () => {
    const query = 'source=test-reader | where event.type="login"';
    const candidates = completionCandidates(query, query.length, templates);

    expect(candidates.map((candidate) => candidate.label)).toEqual(['AND', 'OR', '|']);
  });

  it('suggests logical continuations after boolean function predicates', () => {
    const query = 'source=test-reader | where isnull(pid)';
    expect(completionCandidates(query, query.length, templates).map((candidate) => candidate.label))
      .toEqual(['AND', 'OR', '|']);
  });

  it('filters function argument fields by the current signature', () => {
    const numericQuery = 'source=test-reader | where abs(';
    const numeric = completionCandidates(numericQuery, numericQuery.length, templates);
    expect(numeric.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
    expect(numeric.find((candidate) => candidate.label === 'host.name')?.detail).toContain('implicit conversion');

    const stringQuery = 'source=test-reader | where length(';
    const strings = completionCandidates(stringQuery, stringQuery.length, templates);
    expect(strings.some((candidate) => candidate.label === 'host.name')).toBe(true);
    expect(strings.some((candidate) => candidate.label === 'pid')).toBe(false);
  });

  it('suggests nested functions by expected argument type and cast target types', () => {
    const numericQuery = 'source=test-reader | where abs(sq';
    const numeric = completionCandidates(numericQuery, numericQuery.length, templates);
    expect(numeric.some((candidate) => candidate.label === 'sqrt' && candidate.kind === 'function')).toBe(true);
    expect(numeric.some((candidate) => candidate.label === 'lower')).toBe(false);

    const castQuery = 'source=test-reader | eval value = CAST(event.sequence AS ';
    const castTypes = completionCandidates(castQuery, castQuery.length, templates);
    expect(castTypes.map((candidate) => candidate.label)).toEqual([...PPL_TYPES]);
  });

  it('retains functions whose return type depends on arguments', () => {
    for (const [query, name] of [
      ['source=test-reader | where abs(if', 'if'],
      ['source=test-reader | where abs(cas', 'case'],
      ['source=test-reader | eval value = date_format(from_', 'from_unixtime'],
      ['source=test-reader | eval value = date_format(add', 'adddate'],
    ]) {
      expect(completionCandidates(query, query.length, templates)
        .some((candidate) => candidate.label === name && candidate.kind === 'function'), name).toBe(true);
    }
  });

  it('does not suggest fields or functions inside strings and comments', () => {
    const literal = "source=test-missing | where message == 'lo";
    const comment = 'source=test-missing | where status == 1 // low';
    expect(completionCandidates(literal, literal.length, [])).toEqual([]);
    expect(completionCandidates(comment, comment.length, [])).toEqual([]);
  });
});
