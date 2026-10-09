import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { Registry, parseRawGrammar, type IGrammar } from 'vscode-textmate';
import { ADDITIONAL_MATH_FUNCTIONS } from '../../src/core/catalog/additionalMathFunctions';
import { ADDITIONAL_DATETIME_FUNCTIONS } from '../../src/core/catalog/additionalDatetimeFunctions';
import { ADDITIONAL_DATA_FUNCTIONS } from '../../src/core/catalog/additionalDataFunctions';

let grammar: IGrammar;

beforeAll(async () => {
  await loadWASM(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scopeName) => scopeName === 'source.ppl'
      ? parseRawGrammar(fs.readFileSync(path.join(__dirname, '../../syntaxes/ppl.tmLanguage.json'), 'utf8'), 'ppl.tmLanguage.json')
      : null,
  });
  grammar = (await registry.loadGrammar('source.ppl'))!;
});

function scopesAt(line: string, needle: string, occurrence = 0): string[] {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = line.indexOf(needle, offset + 1);
  }
  expect(offset).toBeGreaterThanOrEqual(0);
  return grammar.tokenizeLine(line, null).tokens.find((token) =>
    token.startIndex <= offset && token.endIndex > offset
  )!.scopes;
}

describe('PPL TextMate grammar', () => {
  it.each([...ADDITIONAL_MATH_FUNCTIONS, ...ADDITIONAL_DATETIME_FUNCTIONS, ...ADDITIONAL_DATA_FUNCTIONS])(
    'highlights researched function $name but not strings or field names', ({ name }) => {
      expect(scopesAt(`| eval result = ${name}()`, `${name}(`)).toContain('support.function.ppl');
      expect(scopesAt(`| fields \`${name}\``, `\`${name}\``)).not.toContain('support.function.ppl');
      expect(scopesAt(`| eval result = '${name}()'`, `${name}(`)).toContain('string.quoted.single.ppl');
    },
  );

  it.each([
    'array', 'array_length', 'forall', 'exists', 'filter', 'transform', 'reduce',
    'mvjoin', 'mvappend', 'split', 'mvdedup', 'mvfind', 'mvindex', 'mvmap', 'mvzip',
  ])('highlights collection function %s without coloring a field of that name', (name) => {
    expect(scopesAt(`| eval result = ${name}()`, name)).toContain('support.function.ppl');
    expect(scopesAt(`| fields ${name}`, name)).not.toContain('support.function.ppl');
  });

  it('highlights a lambda arrow as one operator', () => {
    expect(scopesAt('| eval result = transform(array(1), element -> element + 1)', '->'))
      .toContain('keyword.operator.lambda.ppl');
  });

  it('colors commands, clauses, functions, options, and monitor fields', () => {
    expect(scopesAt('| lookup users user as name replace holiday', 'lookup')).toContain('keyword.control.ppl');
    expect(scopesAt('| lookup users user as name replace holiday', 'replace')).toContain('keyword.other.ppl');
    expect(scopesAt('| rex field=message "(?<user>\\S+)"', 'rex')).toContain('keyword.control.ppl');
    expect(scopesAt('| rex field=message "(?<user>\\S+)"', 'field')).toContain('variable.parameter.ppl');
    expect(scopesAt('| streamstats window=5 distinct_count(user) by host', 'streamstats')).toContain('keyword.control.ppl');
    expect(scopesAt('| streamstats window=5 distinct_count(user) by host', 'distinct_count')).toContain('support.function.ppl');
    expect(scopesAt('| where @timestamp >= TIMESTAMPADD(MINUTE, -5, NOW())', '@timestamp')).toContain('variable.other.ppl');
    expect(scopesAt('| where @timestamp >= TIMESTAMPADD(MINUTE, -5, NOW())', 'TIMESTAMPADD')).toContain('support.function.ppl');
    expect(scopesAt('| where not cidrmatch(source.ip, "10.0.0.0/8")', 'cidrmatch')).toContain('support.function.ppl');
    expect(scopesAt('| stats values(user), first(host) by span(@timestamp, 5m)', 'values')).toContain('support.function.ppl');
    expect(scopesAt('| stats values(user), first(host) by span(@timestamp, 5m)', 'first')).toContain('support.function.ppl');
    expect(scopesAt('| stats values(user), first(host) by span(@timestamp, 5m)', '5m')).toContain('constant.numeric.duration.ppl');
    expect(scopesAt('| where regexp_match(message, "error")', 'regexp_match')).toContain('support.function.ppl');
  });

  it('keeps function names inside strings and command names used as fields uncolored', () => {
    expect(scopesAt('| where message LIKE "lookup now()"', 'lookup')).toContain('string.quoted.double.ppl');
    expect(scopesAt('| fields lookup, status', 'lookup')).not.toContain('keyword.control.ppl');
    expect(scopesAt('| eval lookup = now()', 'lookup')).not.toContain('keyword.control.ppl');
  });

  it('scopes nested PPL within a join subquery without coloring quoted pipes', () => {
    const query = '| join left=l right=r [source=workers | where regexp_match(message, "join | source") | head 5]';
    expect(scopesAt(query, 'source=', 0)).toContain('keyword.control.ppl');
    expect(scopesAt(query, 'where')).toContain('keyword.control.ppl');
    expect(scopesAt(query, 'regexp_match')).toContain('support.function.ppl');
    expect(scopesAt(query, 'source', 1)).toContain('string.quoted.double.ppl');
    expect(scopesAt(query, 'head')).toContain('keyword.control.ppl');
  });

  const documentedForms: Array<[string, string, string]> = [
    ['source = accounts', 'source', 'keyword.control.ppl'],
    ['| lookup workers id as employee replace department as dept', 'lookup', 'keyword.control.ppl'],
    ['| lookup workers id append department', 'append', 'keyword.other.ppl'],
    ['| join type=outer overwrite=false max=0 id [source=workers | head 5]', 'type', 'variable.parameter.ppl'],
    ['| join type=outer overwrite=false max=0 id [source=workers | head 5]', 'max', 'variable.parameter.ppl'],
    ['| left semi join left=l right=r on l.id=r.id workers', 'semi', 'keyword.other.ppl'],
    ['| stats bucket_nullable=false count() by span(@timestamp, 1h)', 'bucket_nullable', 'variable.parameter.ppl'],
    ['| stats count(eval(age > 30)) as mature', 'count', 'support.function.ppl'],
    ['| stats perc99.5(age), p50(age)', 'perc99.5', 'support.function.ppl'],
    ['| stats perc99.5(age), p50(age)', 'p50', 'support.function.ppl'],
    ['| eventstats bucket_nullable=true avg(age) by gender', 'eventstats', 'keyword.control.ppl'],
    ['| streamstats current=false window=2 global=false avg(age) by gender', 'window', 'variable.parameter.ppl'],
    ['| streamstats reset_before="(age>31)" sum(age)', 'reset_before', 'variable.parameter.ppl'],
    ['| sort + gender, - age', 'sort', 'keyword.control.ppl'],
    ['| sort gender asc, age desc', 'desc', 'keyword.other.ppl'],
    ['| sort str(account_number), num(age), ip(source.ip)', 'str', 'support.function.ppl'],
    ['| sort str(account_number), num(age), ip(source.ip)', 'num(', 'support.function.ppl'],
    ['| dedup 2 gender keepempty=true consecutive=true', 'keepempty', 'variable.parameter.ppl'],
    ['| dedup 2 gender keepempty=true consecutive=true', 'consecutive', 'variable.parameter.ppl'],
    ['| rex mode=sed field=email "s/@.*/@company.com/"', 'mode', 'variable.parameter.ppl'],
    ['| rex field=email "(?<user>[^@]+)" max_match=2 offset_field=pos', 'offset_field', 'variable.parameter.ppl'],
    ["| parse email '.+@(?<host>.+)'", 'parse', 'keyword.control.ppl'],
    ['| regex lastname!=".*ms$"', '!=', 'keyword.operator.comparison.ppl'],
    ["| eval label = 'Hello ' + firstname", 'eval', 'keyword.control.ppl'],
    ['| timechart span=1h limit=3 useother=false avg(cpu) by host', 'limit', 'variable.parameter.ppl'],
    ['| timechart timefield=ts usenull=false nullstr="N/A" sum(bytes)', 'timefield', 'variable.parameter.ppl'],
    ["| bin @timestamp span=2h aligntime='@d+3h'", 'aligntime', 'variable.parameter.ppl'],
    ['| bin balance span=2log10 start=0 end=100', '2log10', 'constant.numeric.logarithmic.ppl'],
    ['| fields firstname, account*', 'fields', 'keyword.control.ppl'],
    ['| eval label = case(age > 35, "adult" else "minor")', 'case', 'support.function.ppl'],
    ['| eval date = ADDDATE(DATE("2020-08-26"), INTERVAL 1 HOUR)', 'ADDDATE', 'support.function.ppl'],
    ['| eval date = ADDDATE(DATE("2020-08-26"), INTERVAL 1 HOUR)', 'INTERVAL', 'keyword.other.ppl'],
    ["| eval result = POSITION('world' IN 'helloworld')", 'POSITION', 'support.function.ppl'],
    ["| where cidrmatch(source.ip, '10.0.0.0/8')", 'cidrmatch', 'support.function.ppl'],
  ];

  it.each(documentedForms)('colors documented form %s at %s', (query, token, scope) => {
    expect(scopesAt(query, token)).toContain(scope);
  });
});
