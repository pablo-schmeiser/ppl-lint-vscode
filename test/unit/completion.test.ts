import { describe, expect, it } from 'vitest';
import { completionCandidates } from '../../src/core/completion';
import { parseIndexTemplates } from '../../src/core/indexTemplates';
import { PPL_TYPES } from '../../src/core/pplTypes';

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
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
        pid: { type: long }
`, 'template.yaml');

const lookupTemplates = [...templates, ...parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: workers }
spec:
  indexPatterns: ['workers-*']
  template:
    aliases: { workers-reader: {} }
    mappings:
      properties:
        employee_id: { type: keyword }
        department: { type: keyword }
`, 'workers.yaml')];

const overlappingTemplates = [...lookupTemplates, ...parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: workers-extra }
spec:
  indexPatterns: ['workers-*']
  template:
    aliases: { workers-reader: {} }
    mappings:
      properties:
        pid: { type: keyword }
`, 'workers-extra.yaml')];

describe('completion candidates', () => {
  it('suggests integer fields for integer arguments and numeric or string fields for mixed arguments', () => {
    const integerQuery = 'source=auditd-reader | eval value = rand(';
    const integerFields = completionCandidates(integerQuery, integerQuery.length, templates).filter(({ kind }) => kind === 'field');
    expect(integerFields.map(({ label }) => label)).toEqual(['pid']);
    const mixedQuery = 'source=auditd-reader | eval value = max(';
    const mixedFields = completionCandidates(mixedQuery, mixedQuery.length, templates).filter(({ kind }) => kind === 'field');
    expect(mixedFields.map(({ label }) => label).sort()).toEqual(['host.name', 'pid']);
  });

  it('suggests temporal type constants for get_format instead of interval units', () => {
    const query = 'source=auditd-reader | eval value = get_format(';
    expect(completionCandidates(query, query.length, templates).map(({ label }) => label).sort())
      .toEqual(['DATE', 'TIME', 'TIMESTAMP']);
  });

  it('suggests configured lookup indexes by prefix', () => {
    const query = 'source=auditd-reader | lookup wor';
    expect(completionCandidates(query, query.length, lookupTemplates)
      .some((candidate) => candidate.label === 'workers-reader' && candidate.kind === 'source')).toBe(true);
  });

  it('completes lookup keys and output fields from the lookup index', () => {
    for (const clause of ['lookup workers-reader emp', 'lookup workers-reader employee_id, dep',
      'lookup workers-reader employee_id replace dep', 'lookup workers-reader employee_id output dep']) {
      const query = `source=auditd-reader | ${clause}`;
      const candidates = completionCandidates(query, query.length, lookupTemplates);
      expect(candidates.some((candidate) => candidate.label === (clause.endsWith('emp') ? 'employee_id' : 'department') &&
        candidate.kind === 'field'), clause).toBe(true);
      expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field'), clause).toBe(false);
    }
  });

  it('completes lookup mapping and append aliases from source fields but not replace aliases', () => {
    for (const clause of ['lookup workers-reader employee_id as pi',
      'lookup workers-reader employee_id append department as pi']) {
      const query = `source=auditd-reader | ${clause}`;
      const candidates = completionCandidates(query, query.length, lookupTemplates);
      expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field'), clause).toBe(true);
      expect(candidates.some((candidate) => candidate.label === 'department' && candidate.kind === 'field'), clause).toBe(false);
    }
    const alias = 'source=auditd-reader | lookup workers-reader employee_id replace department as ';
    expect(completionCandidates(alias, alias.length, lookupTemplates)).toEqual([]);
  });

  it('respects index allowlists for lookup schemas and source fields', () => {
    const index = 'source=auditd-reader | lookup wor';
    expect(completionCandidates(index, index.length, lookupTemplates, ['auditd-reader'])).toEqual([]);
    const key = 'source=auditd-reader | lookup workers-reader emp';
    expect(completionCandidates(key, key.length, lookupTemplates, ['auditd-reader'])
      .some((candidate) => candidate.kind === 'field')).toBe(false);
  });

  it('offers lookup mapping and output-mode keywords at the right boundary', () => {
    const key = 'source=auditd-reader | lookup workers-reader employee_id ';
    expect(completionCandidates(key, key.length, lookupTemplates).map((candidate) => candidate.label))
      .toEqual(['as', 'replace', 'append', 'output']);
    const mapped = 'source=auditd-reader | lookup workers-reader employee_id as pid rep';
    expect(completionCandidates(mapped, mapped.length, lookupTemplates).map((candidate) => candidate.label))
      .toEqual(['replace']);
  });

  it('offers lookup output fields in downstream stages', () => {
    for (const [lookup, expected, absent] of [
      ['lookup workers-reader employee_id as pid', 'department', 'employee_id'],
      ['lookup workers-reader employee_id as pid replace department as team', 'team', 'department'],
    ]) {
      const query = `source=auditd-reader | ${lookup} | where `;
      const fields = completionCandidates(query, query.length, lookupTemplates)
        .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
      expect(fields, lookup).toContain(expected);
      expect(fields, lookup).not.toContain(absent);
      expect(fields, lookup).toContain('pid');
    }
    const append = 'source=auditd-reader | lookup workers-reader employee_id as pid append department as new_field | where ';
    expect(completionCandidates(append, append.length, lookupTemplates)
      .some((candidate) => candidate.label === 'new_field' && candidate.kind === 'field')).toBe(false);
  });

  it('completes join field lists from the input and join datasets from configured sources', () => {
    const key = 'source=auditd-reader | join pi';
    const keys = completionCandidates(key, key.length, lookupTemplates);
    expect(keys.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
    expect(keys.some((candidate) => candidate.label === 'employee_id' && candidate.kind === 'field')).toBe(false);
    const dataset = 'source=auditd-reader | join pid wor';
    expect(completionCandidates(dataset, dataset.length, lookupTemplates)
      .some((candidate) => candidate.label === 'workers-reader' && candidate.kind === 'source')).toBe(true);
    const finished = 'source=auditd-reader | join pid workers-reader ';
    expect(completionCandidates(finished, finished.length, lookupTemplates)).toEqual([]);
  });

  it('completes aliased join criteria from the correct side', () => {
    const query = 'source=auditd-reader | join left=l right=r on l.pi = r.emp workers-reader';
    const left = completionCandidates(query, query.indexOf('l.pi') + 'l.pi'.length, lookupTemplates);
    expect(left.some((candidate) => candidate.label === 'l.pid' && candidate.kind === 'field')).toBe(true);
    expect(left.some((candidate) => candidate.label === 'l.employee_id')).toBe(false);
    const right = completionCandidates(query, query.indexOf('r.emp') + 'r.emp'.length, lookupTemplates);
    expect(right.some((candidate) => candidate.label === 'r.employee_id' && candidate.kind === 'field')).toBe(true);
    expect(right.some((candidate) => candidate.label === 'r.pid')).toBe(false);
  });

  it('completes scalar function arguments and continuations in join criteria', () => {
    const argument = 'source=auditd-reader | join on lower(';
    const argumentFields = completionCandidates(argument, argument.length, lookupTemplates);
    expect(argumentFields.some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field')).toBe(true);
    expect(argumentFields.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(false);
    const query = 'source=auditd-reader | join left=l right=r on lower(l.ho) = r.department workers-reader';
    const candidates = completionCandidates(query, query.indexOf('l.ho') + 'l.ho'.length, lookupTemplates);
    expect(candidates.some((candidate) => candidate.label === 'l.host.name' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'l.pid' && candidate.kind === 'field')).toBe(false);
    const nested = 'source=auditd-reader | join on low';
    expect(completionCandidates(nested, nested.length, lookupTemplates)
      .some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
    const complete = 'source=auditd-reader | join left=l right=r on l.pid = r.employee_id ';
    const labels = completionCandidates(complete, complete.length, lookupTemplates).map((candidate) => candidate.label);
    expect(labels).toContain('AND');
    expect(labels).toContain('OR');
  });

  it('completes nested join queries against their own source', () => {
    const query = 'source=auditd-reader | join left=l right=r [source=workers-reader | where dep';
    const candidates = completionCandidates(query, query.length, lookupTemplates);
    expect(candidates.some((candidate) => candidate.label === 'department' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(false);
    const source = 'source=auditd-reader | join pid [source=wor';
    expect(completionCandidates(source, source.length, lookupTemplates)
      .some((candidate) => candidate.label === 'workers-reader' && candidate.kind === 'source')).toBe(true);
  });

  it('offers a join dataset after a completed criterion and its fields in earlier criteria', () => {
    const dataset = 'source=auditd-reader | join left=l right=r on l.pid = r.employee_id wor';
    expect(completionCandidates(dataset, dataset.length, lookupTemplates)
      .some((candidate) => candidate.label === 'workers-reader' && candidate.kind === 'source')).toBe(true);
    const subquery = 'source=auditd-reader | join left=l right=r on r.emp [source=workers-reader | head 1]';
    expect(completionCandidates(subquery, subquery.indexOf('r.emp') + 'r.emp'.length, lookupTemplates)
      .some((candidate) => candidate.label === 'r.employee_id' && candidate.kind === 'field')).toBe(true);
    const finished = 'source=auditd-reader | join on pid = employee_id workers-reader ';
    const afterDataset = completionCandidates(finished, finished.length, lookupTemplates);
    expect(afterDataset.some((candidate) => ['AND', 'OR', 'workers-reader'].includes(candidate.label))).toBe(false);
  });

  it('uses fields output by a join subquery and the active join in a pipeline', () => {
    const transformed = 'source=auditd-reader | join left=l right=r on r.te [source=workers-reader | rename department as team]';
    const candidates = completionCandidates(transformed, transformed.indexOf('r.te') + 'r.te'.length, lookupTemplates);
    expect(candidates.some((candidate) => candidate.label === 'r.team' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'r.department')).toBe(false);
    const successive = 'source=auditd-reader | join pid workers-reader | join left=a right=b on b.emp workers-reader';
    expect(completionCandidates(successive, successive.indexOf('b.emp') + 'b.emp'.length, lookupTemplates)
      .some((candidate) => candidate.label === 'b.employee_id' && candidate.kind === 'field')).toBe(true);
  });

  it('completes join type and overwrite options without filling free aliases', () => {
    const name = 'source=auditd-reader | join ty';
    expect(completionCandidates(name, name.length, lookupTemplates).map((candidate) => candidate.label)).toContain('type');
    const next = 'source=auditd-reader | join left=l ri';
    expect(completionCandidates(next, next.length, lookupTemplates).map((candidate) => candidate.label)).toContain('right');
    const type = 'source=auditd-reader | join type=ou';
    expect(completionCandidates(type, type.length, lookupTemplates).map((candidate) => candidate.label)).toContain('outer');
    const semi = 'source=auditd-reader | join type=se';
    expect(completionCandidates(semi, semi.length, lookupTemplates).map((candidate) => candidate.label)).toContain('semi');
    const overwrite = 'source=auditd-reader | join overwrite=tr';
    expect(completionCandidates(overwrite, overwrite.length, lookupTemplates).map((candidate) => candidate.label)).toEqual(['true']);
    const alias = 'source=auditd-reader | join left=';
    expect(completionCandidates(alias, alias.length, lookupTemplates)).toEqual([]);
  });

  it('offers right-side output fields after joins except semi and anti joins', () => {
    for (const join of [
      'join on pid = employee_id workers-reader',
      'join pid [source=workers-reader | rename department as team]',
    ]) {
      const query = `source=auditd-reader | ${join} | where `;
      const names = completionCandidates(query, query.length, lookupTemplates)
        .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
      expect(names, join).toContain(join.includes('rename') ? 'team' : 'department');
      expect(names, join).toContain('pid');
    }
    for (const join of [
      'left semi join left=l right=r on l.pid = r.employee_id workers-reader',
      'join type=anti on pid = employee_id workers-reader',
    ]) {
      const query = `source=auditd-reader | ${join} | where `;
      expect(completionCandidates(query, query.length, lookupTemplates)
        .some((candidate) => candidate.label === 'department' && candidate.kind === 'field'), join).toBe(false);
    }
  });

  it('qualifies colliding basic join fields and honors field-list overwrite', () => {
    const basic = 'source=auditd-reader | join left=l right=r on l.pid = r.pid workers-reader | where ';
    const names = completionCandidates(basic, basic.length, overlappingTemplates)
      .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
    expect(names).toContain('l.pid');
    expect(names).toContain('r.pid');
    expect(names).not.toContain('pid');
    expect(names).toContain('department');

    const keep = 'source=auditd-reader | join overwrite=false pid workers-reader | where pid';
    const replace = 'source=auditd-reader | join overwrite=true pid workers-reader | where pid';
    expect(completionCandidates(keep, keep.length, overlappingTemplates).find((candidate) => candidate.label === 'pid')?.detail)
      .toContain('bigint');
    expect(completionCandidates(replace, replace.length, overlappingTemplates).find((candidate) => candidate.label === 'pid')?.detail)
      .toContain('string');
    const datasetAlias = 'source=auditd-reader | join on pid = pid [source=workers-reader] as w | where ';
    const aliasedNames = completionCandidates(datasetAlias, datasetAlias.length, overlappingTemplates)
      .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
    expect(aliasedNames).toContain('w.pid');
    expect(aliasedNames).not.toContain('workers-reader.pid');
    const aliasedCriterion = 'source=auditd-reader | join on w.pi [source=workers-reader] as w';
    expect(completionCandidates(aliasedCriterion, aliasedCriterion.indexOf('w.pi') + 'w.pi'.length, overlappingTemplates)
      .some((candidate) => candidate.label === 'w.pid' && candidate.kind === 'field')).toBe(true);
  });

  it('offers aliases at source and fields visible at the current stage', () => {
    expect(completionCandidates('source=aud', 10, templates).map((item) => item.label)).toContain('auditd-reader');
    const input = 'source=auditd-reader | stats count(pid) as total by host.name';
    expect(completionCandidates(input, input.indexOf('pid'), templates).map((item) => item.label)).toContain('pid');
    const output = `${input} | where `;
    expect(completionCandidates(output, output.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label)).toEqual(['total', 'host.name']);
  });

  it('offers every input field in fields projections, including after commas', () => {
    const emptyProjection = 'source=auditd-reader | fields ';
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
    const query = 'source=auditd-reader | where pid > 0 | fields host.name, ';
    const labels = completionCandidates(query, query.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label);
    expect(labels).toContain('pid');
    expect(labels).not.toContain('host.name');
  });

  it('suggests fields in field-taking command positions', () => {
    for (const command of ['top 5 ho', 'rare 5 ho', 'grok ho', 'patterns ho', 'parse ho', 'regex ho', 'bin ho', 'rex field=ho']) {
      const query = `source=auditd-reader | ${command}`;
      expect(completionCandidates(query, query.length, templates)
        .some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field'), command).toBe(true);
    }
  });

  it('does not suggest fields after single-field command operands', () => {
    for (const command of ['grok host.name ', 'patterns host.name ', 'parse host.name ', 'regex host.name=', 'bin host.name span=']) {
      const query = `source=auditd-reader | ${command}`;
      expect(completionCandidates(query, query.length, templates)
        .some((candidate) => candidate.kind === 'field'), command).toBe(false);
    }
  });

  it('keeps schema fields unavailable without templates but still suggests built-ins', () => {
    const candidates = completionCandidates('source=missing | where ', 23, []);
    expect(candidates.some((candidate) => candidate.kind === 'field')).toBe(false);
    expect(candidates.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
  });

  it('limits source and field suggestions to the configured index allowlist', () => {
    const sourceCandidates = completionCandidates('source=aud', 10, templates, ['auditd-reader']);
    expect(sourceCandidates.map((candidate) => candidate.label)).toEqual(['auditd-reader']);

    const query = 'source=other-index | where ';
    const fieldCandidates = completionCandidates(query, query.length, templates, ['auditd-*']);
    expect(fieldCandidates.some((candidate) => candidate.kind === 'field')).toBe(false);
    expect(fieldCandidates.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
  });

  it('suggests functions without loading index templates', () => {
    const query = 'source=missing | eval label = lo';
    const candidates = completionCandidates(query, query.length, []);
    const lower = candidates.find((candidate) => candidate.label === 'lower' && candidate.kind === 'function');
    expect(lower?.detail).toBe('lower(string)');
    expect(lower?.documentation).toContain('Converts a string to lowercase.');
    expect(lower?.documentation).toContain('OpenSearch PPL reference');
  });

  it('suggests pipeline commands after a pipe and aggregations after stats', () => {
    const afterPipe = 'source=auditd-reader | ';
    const commands = completionCandidates(afterPipe, afterPipe.length, templates);
    expect(commands.find((candidate) => candidate.label === 'stats' && candidate.kind === 'command')?.retriggerAfterAccept).toBe(true);

    const stats = 'source=auditd-reader | stats ';
    const aggregations = completionCandidates(stats, stats.length, templates);
    expect(aggregations.find((candidate) => candidate.label === 'count' && candidate.kind === 'function')?.retriggerAfterAccept).toBe(true);
    expect(aggregations.some((candidate) => candidate.label === 'sum' && candidate.kind === 'function')).toBe(true);
    expect(aggregations.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(false);
    expect(aggregations.some((candidate) => candidate.kind === 'field')).toBe(false);
  });

  it('keeps input fields available in an unfinished stats grouping clause', () => {
    const query = 'source=auditd-reader | stats count() by ';
    const candidates = completionCandidates(query, query.length, templates);
    expect(candidates.some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.label === 'count' && candidate.kind === 'function')).toBe(false);
    expect(candidates.some((candidate) => candidate.label === 'span' && candidate.kind === 'function')).toBe(true);
  });

  it('suggests scalar functions inside aggregation arguments, not nested aggregates', () => {
    for (const command of ['stats', 'eventstats', 'streamstats', 'timechart']) {
      const query = `source=auditd-reader | ${command} sum(ab`;
      const candidates = completionCandidates(query, query.length, templates);
      expect(candidates.some((candidate) => candidate.label === 'abs' && candidate.kind === 'function')).toBe(true);
      expect(candidates.some((candidate) => candidate.label === 'avg' && candidate.kind === 'function')).toBe(false);
    }
  });

  it('suggests fields but no aggregate functions after timechart by', () => {
    const query = 'source=auditd-reader | timechart count() by ';
    const candidates = completionCandidates(query, query.length, templates);
    expect(candidates.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'function')).toBe(false);
  });

  it('does not suggest aggregate functions in timechart option values', () => {
    for (const command of ['timechart span=', 'streamstats window=', 'stats bucket_nullable=']) {
      const query = `source=auditd-reader | ${command}`;
      expect(completionCandidates(query, query.length, templates).some((candidate) => candidate.kind === 'function'), command).toBe(false);
    }
    const timefield = 'source=auditd-reader | timechart timefield=ho';
    expect(completionCandidates(timefield, timefield.length, templates)
      .some((candidate) => candidate.label === 'host.name' && candidate.kind === 'field')).toBe(true);
    const reset = 'source=auditd-reader | streamstats reset_before=pi';
    expect(completionCandidates(reset, reset.length, templates)
      .some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
  });

  it('does not suggest computed fields from an unfinished earlier assignment', () => {
    const query = 'source=auditd-reader | eval size = | stats sum(';
    const fields = completionCandidates(query, query.length, templates)
      .filter((candidate) => candidate.kind === 'field').map((candidate) => candidate.label);
    expect(fields).toContain('pid');
    expect(fields).not.toContain('size');
  });

  it('suggests logical and pipeline continuations after a where comparison', () => {
    const query = 'source=auditd-reader | where event.type="login"';
    const candidates = completionCandidates(query, query.length, templates);

    expect(candidates.map((candidate) => candidate.label)).toEqual(['AND', 'OR', '|']);
  });

  it('suggests logical continuations after boolean function predicates', () => {
    const query = 'source=auditd-reader | where isnull(pid)';
    expect(completionCandidates(query, query.length, templates).map((candidate) => candidate.label))
      .toEqual(['AND', 'OR', '|']);
  });

  it('filters function argument fields by the current signature', () => {
    const numericQuery = 'source=auditd-reader | where abs(';
    const numeric = completionCandidates(numericQuery, numericQuery.length, templates);
    expect(numeric.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
    expect(numeric.find((candidate) => candidate.label === 'host.name')?.detail).toContain('implicit conversion');

    const stringQuery = 'source=auditd-reader | where length(';
    const strings = completionCandidates(stringQuery, stringQuery.length, templates);
    expect(strings.some((candidate) => candidate.label === 'host.name')).toBe(true);
    expect(strings.some((candidate) => candidate.label === 'pid')).toBe(false);
  });

  it('suggests nested functions by expected argument type and cast target types', () => {
    const numericQuery = 'source=auditd-reader | where abs(sq';
    const numeric = completionCandidates(numericQuery, numericQuery.length, templates);
    expect(numeric.some((candidate) => candidate.label === 'sqrt' && candidate.kind === 'function')).toBe(true);
    expect(numeric.some((candidate) => candidate.label === 'lower')).toBe(false);

    const castQuery = 'source=auditd-reader | eval value = CAST(event.sequence AS ';
    const castTypes = completionCandidates(castQuery, castQuery.length, templates);
    expect(castTypes.map((candidate) => candidate.label)).toEqual([...PPL_TYPES]);
  });

  it('retains functions whose return type depends on arguments', () => {
    for (const [query, name] of [
      ['source=auditd-reader | where abs(if', 'if'],
      ['source=auditd-reader | where abs(cas', 'case'],
      ['source=auditd-reader | eval value = date_format(from_', 'from_unixtime'],
      ['source=auditd-reader | eval value = date_format(add', 'adddate'],
    ]) {
      expect(completionCandidates(query, query.length, templates)
        .some((candidate) => candidate.label === name && candidate.kind === 'function'), name).toBe(true);
    }
  });

  it('does not suggest fields or functions inside strings and comments', () => {
    const literal = "source=missing | where message == 'lo";
    const comment = 'source=missing | where status == 1 // low';
    expect(completionCandidates(literal, literal.length, [])).toEqual([]);
    expect(completionCandidates(comment, comment.length, [])).toEqual([]);
  });
});
