import { describe, expect, it } from 'vitest';
import { ADDITIONAL_MATH_FUNCTIONS, STATISTICAL_FUNCTIONS } from '../../src/core/catalog/additionalMathFunctions';
import { ADDITIONAL_DATETIME_FUNCTIONS } from '../../src/core/catalog/additionalDatetimeFunctions';
import { ADDITIONAL_DATA_FUNCTIONS } from '../../src/core/catalog/additionalDataFunctions';
import { functionDocumentation } from '../../src/core/catalog/functionDocumentation';
import { parseIndexTemplates } from '../../src/core/indexTemplates';
import { PplLinter } from '../../src/core/linter';
import { typedFieldScopeAt } from '../../src/core/schemaTypeChecker';
import { DEFAULT_KNOWN_FUNCTIONS } from '../../src/core/catalog/functions';
import { getFunctionSignature } from '../../src/core/catalog/functionSignatures';
import { completionCandidates } from '../../src/core/completion';

const PREVIOUSLY_MISSING = [
  'tostring tonumber sha2 locate reverse geoip',
  'json json_valid json_object json_array json_array_length json_extract json_delete json_set json_append json_extend json_keys',
  'match match_phrase_prefix multi_match simple_query_string match_bool_prefix query_string',
  'add subtract multiply divide acos asin atan atan2 conv cos cosh cot crc32 degrees e expm1 mod modulus pi radians rand sign signum sin sinh rint',
  'addtime curdate current_date current_time curtime datetime datediff dayofmonth day_of_month dayofweek day_of_week dayofyear day_of_year from_days get_format hour_of_day last_day localtimestamp localtime makedate maketime microsecond minute_of_hour month_of_year monthname period_add period_diff quarter sec_to_time second_of_minute strftime str_to_date subdate subtime sysdate time time_format time_to_sec timediff to_days to_seconds utc_date utc_time utc_timestamp week weekday week_of_year yearweek',
].flatMap((names) => names.split(' '));

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: people }
spec:
  indexPatterns: ['people']
  template:
    mappings:
      properties:
        age: { type: integer }
        name: { type: keyword }
`, 'people.yaml');

describe('documented OpenSearch functions', () => {
  it('covers all 97 names previously missing from the supplied reference list', () => {
    expect(new Set(PREVIOUSLY_MISSING).size).toBe(97);
    for (const name of PREVIOUSLY_MISSING) {
      expect(DEFAULT_KNOWN_FUNCTIONS, name).toContain(name);
      expect(getFunctionSignature(name), name).toBeDefined();
      const documentation = functionDocumentation(name)!;
      expect(documentation.description.length, name).toBeGreaterThan(15);
      expect(documentation.docUrl, name).toMatch(new RegExp(`/3\\.5/sql-and-ppl/ppl/functions/[^/]+/#${name}$`));
      expect(documentation.hasSignature, name).toBe(true);
      const context = documentation.contexts.includes('where') ? 'where' : 'eval result =';
      const query = `source=people | ${context} `;
      expect(completionCandidates(query, query.length, templates).some((candidate) => candidate.kind === 'function' && candidate.label === name), name).toBe(true);
    }
  });
  it.each([...ADDITIONAL_MATH_FUNCTIONS, ...STATISTICAL_FUNCTIONS, ...ADDITIONAL_DATETIME_FUNCTIONS, ...ADDITIONAL_DATA_FUNCTIONS.filter(({ category }) => category !== 'Relevance')])('validates the researched example for $name', (entry) => {
    for (const example of entry.examples) {
      const query = `source=people ${example} | fields result`;
      expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates), query).toEqual([]);
    }
    expect(functionDocumentation(entry.name)).toMatchObject({
      hasSignature: true,
      description: entry.description,
      docUrl: `https://docs.opensearch.org/3.5/sql-and-ppl/ppl/functions/${entry.path}/#${entry.name}`,
    });
  });

  it.each([
    ['add(1, 2.5)', 'double'],
    ['rand()', 'float'],
    ['min(1, 2.5, name)', 'double'],
    ['max(1, 2.5, name)', 'string'],
    ['min(3, 2)', 'int'],
    ['max(3, 2)', 'int'],
  ])('infers %s as %s', (expression, resultType) => {
    const query = `source=people | eval result = ${expression} | fields result`;
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates)).toEqual([]);
    expect(typedFieldScopeAt(query, templates, query.length)?.get('result')?.pplTypes).toEqual([resultType]);
  });

  it.each(['add(1)', 'atan2(1)', 'rand(1.5)', 'conv(true, 10, 16)', 'max(true, 1)'])('rejects invalid arguments in %s', (expression) => {
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(`source=people | eval result = ${expression}`, templates);
    expect(diagnostics.some(({ code }) => code === 'PPL014')).toBe(true);
  });

  it.each([
    ["addtime(time('10:00:00'), time('01:00:00'))", 'time'],
    ["subtime(timestamp('2020-01-01 10:00:00'), time('01:00:00'))", 'timestamp'],
    ["subdate(date('2020-01-01'), 1)", 'date'],
    ["subdate(date('2020-01-01'), INTERVAL 1 DAY)", 'timestamp'],
    ['localtime()', 'timestamp'],
    ["strftime(date('2020-01-01'), '%Y')", 'string'],
  ])('infers temporal expression %s as %s', (expression, resultType) => {
    const query = `source=people | eval result = ${expression} | fields result`;
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates)).toEqual([]);
    expect(typedFieldScopeAt(query, templates, query.length)?.get('result')?.pplTypes).toEqual([resultType]);
  });

  it.each(["get_format(BADTYPE, 'USA')", "get_format(DATE, 'bad')", 'sysdate(7)', "week(date('2020-01-01'), 8)", "strftime('2020-01-01', '%Y')"])(
    'rejects invalid temporal arguments in %s', (expression) => {
      const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(`source=people | eval result = ${expression}`, templates);
      expect(diagnostics.some(({ code }) => code === 'PPL014')).toBe(true);
    },
  );

  it.each([
    "tonumber('10', 1)", "sha2('hello', 128)", 'typeof()',
    "json_object('a', 1, 'b')", "json_object('a', 1, 2, 'value')",
    "json_set('{}', 'a', 1, 'b')", "json_extend('{}', 'a', 1, 2, 'value')",
  ])('rejects invalid data function arguments in %s', (expression) => {
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(`source=people | eval result = ${expression}`, templates);
    expect(diagnostics.some(({ code }) => code === 'PPL014')).toBe(true);
  });

  it.each(ADDITIONAL_DATA_FUNCTIONS.filter(({ category }) => category === 'Relevance'))('validates relevance examples for $name', (entry) => {
    for (const example of entry.examples) {
      const query = `source=people ${example}`;
      expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates), query).toEqual([]);
    }
    expect(functionDocumentation(entry.name)?.docUrl).toBe(`https://docs.opensearch.org/3.5/sql-and-ppl/ppl/functions/relevance/#${entry.name}`);
  });

  it.each([
    "multi_match(['name' 3.4, `age` ^ 0.3], 'text', analyzer=default)",
    "query_string('text', default_operator='AND')",
    'match(age, 30, lenient=true)',
  ])('accepts relevance syntax %s', (expression) => {
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(`source=people | where ${expression}`, templates)).toEqual([]);
  });

  it.each([
    "multi_match([name])", "multi_match('text', 'extra')", "match(name, 'text', bogus=1)",
    "match(name, 'text', lenient=1)", "query_string([], 'text')", "multi_match([missing], 'text')",
    "multi_match([name], 'text', tie_breaker=2)", "match_phrase(name, 'text', slop=true)",
  ])('rejects invalid relevance expression %s', (expression) => {
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(`source=people | where ${expression}`, templates);
    expect(diagnostics.some(({ severity }) => severity === 'error')).toBe(true);
  });

  it('ignores tostring format values for boolean input as documented', () => {
    const query = "source=people | eval result = tostring(true, 'ignored') | fields result";
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates)).toEqual([]);
  });

  it('validates negative integer constants in bounded function arguments', () => {
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint('source=people | eval result = sysdate(-1)', templates)
      .some(({ code }) => code === 'PPL014')).toBe(true);
  });
});
