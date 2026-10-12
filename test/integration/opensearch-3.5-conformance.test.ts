import { describe, expect, it } from 'vitest';
import { PplLinter } from '../../src/core/linter';

const docs = 'https://docs.opensearch.org/3.5/sql-and-ppl/ppl';
const linter = new PplLinter({ openSearchVersion: '3.5' });

const suites: Array<{
  reference: string;
  cases: Array<[name: string, query: string]>;
}> = [
  {
    reference: `${docs}/commands/lookup/`,
    cases: [
      ['single lookup key', 'source=test_accounts | lookup test_workers id'],
      ['multiple keys and alias', 'source=test_accounts | lookup test_workers id as cid, name'],
      ['replace mapped fields', 'source=test_accounts | lookup test_workers id as cid, name replace dept as department, city as location'],
      ['append mapped fields', 'source=test_accounts | lookup test_workers id as cid, name append dept as department'],
    ],
  },
  {
    reference: `${docs}/commands/join/`,
    cases: [
      ['inner join with aliases', 'source=test_accounts | inner join left=l right=r on l.id = r.id test_workers'],
      ['left semi join', 'source=test_accounts | left semi join left=l right=r on l.id = r.id test_workers'],
      ['left anti join', 'source=test_accounts | left anti join left=l right=r on l.id = r.id test_workers'],
      ['join with subquery', 'source=test_accounts | join left=l right=r [ source=test_workers | where age>10 | head 5 ]'],
      ['extended join options', 'source=test_accounts | join type=outer overwrite=false max=0 id [source=test_workers | rename dept as id]'],
    ],
  },
  {
    reference: `${docs}/commands/stats/`,
    cases: [
      ['group with span', 'source=test_accounts | stats count() by span(age, 10)'],
      ['nullable buckets', 'source=test_accounts | stats bucket_nullable=false count() as cnt by employer'],
      ['time span shorthand', 'source=test_accounts | stats count() by span(1month)'],
    ],
  },
  {
    reference: `${docs}/commands/eventstats/`,
    cases: [
      ['preserve rows with aggregation', 'source=test_accounts | eventstats avg(age) by gender'],
      ['nullable buckets', 'source=test_accounts | eventstats bucket_nullable=true count() as cnt by employer'],
    ],
  },
  {
    reference: `${docs}/commands/streamstats/`,
    cases: [
      ['running average', 'source=test_accounts | streamstats avg(age) as running_avg by gender'],
      ['window and current options', 'source=test_accounts | streamstats current=false window=2 max(age)'],
      ['global window', 'source=test_accounts | streamstats window=2 global=false avg(age) by gender'],
      ['reset before', 'source=test_accounts | streamstats window=2 reset_before=age>31 avg(age)'],
      ['reset after', 'source=test_accounts | streamstats current=false reset_after=age>31 avg(age) by gender'],
    ],
  },
  {
    reference: `${docs}/commands/sort/`,
    cases: [
      ['prefix directions', 'source=test_accounts | sort + gender, - age'],
      ['suffix directions', 'source=test_accounts | sort gender asc, age desc'],
      ['suffix direction abbreviations', 'source=test_accounts | sort gender a, age d'],
      ['typed sort fields', 'source=test_accounts | sort str(account_number), num(age)'],
      ['sort count', 'source=test_accounts | sort 2 age'],
    ],
  },
  {
    reference: `${docs}/commands/dedup/`,
    cases: [
      ['count and options (requires legacy SQL engine for consecutive)', 'source=test_accounts | dedup 2 gender keepempty=true consecutive=true'],
      ['keep empty documents', 'source=test_accounts | dedup email keepempty=true'],
      ['consecutive documents (requires legacy SQL engine)', 'source=test_accounts | dedup gender consecutive=true'],
      ['deduplicate by field', 'source=test_accounts | dedup gender'],
    ],
  },
  {
    reference: `${docs}/commands/rex/`,
    cases: [
      ['named capture groups', 'source=test_accounts | rex field=email "(?<username>[^@]+)@(?<domain>[^.]+)"'],
      ['multiple matches and offsets', 'source=test_accounts | rex field=email "(?<name>[^@]+)" max_match=2 offset_field=matchpos'],
      ['unlimited matches subject to configured limit', 'source=test_accounts | rex field=email "(?<name>[^@]+)" max_match=0'],
      ['sed mode', 'source=test_accounts | rex field=email mode=sed "s/@.*/@company.com/"'],
    ],
  },
  {
    reference: `${docs}/commands/parse/`,
    cases: [['parse named capture', "source=test_accounts | parse email '.+@(?<host>.+)' "]],
  },
  {
    reference: `${docs}/commands/regex/`,
    cases: [
      ['positive regex', 'source=test_accounts | regex lastname="^[A-Z][a-z]+$"'],
      ['negative regex', 'source=test_accounts | regex lastname!=".*ms$"'],
    ],
  },
  {
    reference: `${docs}/commands/timechart/`,
    cases: [
      ['span and limit', 'source=test_accounts | timechart span=1h limit=3 useother=false avg(age) by gender'],
      ['all categories', 'source=test_events | timechart span=1h limit=0 count() by host'],
      ['null category options', 'source=test_events | timechart span=1h usenull=true nullstr="unknown" count() by host'],
      ['per-second rate', 'source=test_events | timechart span=30m per_second(packets) by host'],
    ],
  },
  {
    reference: `${docs}/commands/bin/`,
    cases: [
      ['align time bins', "source=test_accounts | bin @timestamp span=2h aligntime='@d+3h'"],
      ['logarithmic span', 'source=test_accounts | bin balance span=2log10'],
      ['numeric bounds', 'source=test_accounts | bin age span=1 start=25 end=35'],
    ],
  },
  {
    reference: `${docs}/functions/aggregations/`,
    cases: [
      ['filtered count', 'source=test_accounts | stats count(eval(age > 30)) as mature_users'],
      ['distinct count aliases', 'source=test_accounts | stats dc(state) as distinct_states, distinct_count(state) as alternate by gender'],
      ['percentile shortcuts', 'source=test_accounts | stats perc99.5(age), p50(age)'],
      ['collect distinct values', 'source=test_accounts | stats values(firstname)'],
      ['first and last values', 'source=test_accounts | stats first(firstname), last(lastname) by gender'],
      ['approximate cardinality', 'source=test_accounts | stats distinct_count_approx(gender)'],
      ['sample variance and standard deviation', 'source=test_accounts | stats var_samp(age), stddev_pop(age)'],
      ['percentile with explicit percent', 'source=test_accounts | stats percentile(age, 90) by gender'],
      ['median', 'source=test_accounts | stats median(age)'],
    ],
  },
  {
    reference: `${docs}/functions/condition/`,
    cases: [
      ['conditional default', "source=test_accounts | eval result = case(age > 35, firstname, age < 30, lastname else employer)"],
      ['coalesce multiple fields', 'source=test_accounts | eval result = coalesce(employer, firstname, lastname)'],
      ['check null in filter', 'source=test_accounts | where isnull(employer)'],
      ['regex function', "source=test_accounts | where regexp_match(email, '.*@.*')"],
      ['conditional IF with null test', "source=test_accounts | eval status = if(isnull(employer), 'unemployed', 'employed')"],
      ['conditional IFNULL fallback', "source=test_accounts | eval status = ifnull(employer, 'default')"],
      ['missing field check', 'source=test_accounts | where ispresent(employer)'],
      ['blank field check', 'source=test_accounts | where isblank(employer)'],
      ['relative earliest and latest', "source=test_accounts | where earliest('-2d@d', @timestamp) AND latest('now', @timestamp)"],
    ],
  },
  {
    reference: `${docs}/functions/datetime/`,
    cases: [
      ['timestamp interval', 'source=test_accounts | eval next = TIMESTAMPADD(DAY, 17, NOW())'],
      ['SQL interval expression', "source=test_accounts | eval next = ADDDATE(DATE('2020-08-26'), INTERVAL 1 HOUR)"],
      ['timezone conversion', "source=test_accounts | eval local = CONVERT_TZ('2008-05-15 12:00:00', '+00:00', '+10:00')"],
      ['formatted date', "source=test_accounts | eval formatted = DATE_FORMAT(NOW(), '%Y-%m-%d')"],
      ['timezone conversion with negative offset', "source=test_accounts | eval local = CONVERT_TZ('2008-05-15 12:00:00', '+03:30', '-10:00')"],
      ['date extraction with FROM', 'source=test_accounts | eval yearmonth = extract(YEAR_MONTH FROM "2023-02-07 10:11:12")'],
      ['UNIX timestamp without argument', 'source=test_accounts | eval epoch = UNIX_TIMESTAMP()'],
      ['UNIX timestamp with argument', "source=test_accounts | eval epoch = UNIX_TIMESTAMP(TIMESTAMP('1996-11-15 17:05:42'))"],
      ['FROM_UNIXTIME with format', "source=test_accounts | eval formatted = FROM_UNIXTIME(1220249547, '%T')"],
    ],
  },
  {
    reference: `${docs}/functions/string/`,
    cases: [
      ['three-argument like', "source=test_accounts | eval result = LIKE('hello world', '_ELLo%', true)"],
      ['position with IN', "source=test_accounts | eval result = POSITION('world' IN 'helloworld')"],
      ['case-insensitive ILIKE', "source=test_accounts | eval result = ILIKE('hello world', '_ELLo%')"],
      ['regex replacement', "source=test_accounts | eval result = REGEXP_REPLACE('test123', '[0-9]+', '')"],
    ],
  },
  {
    reference: `${docs}/functions/ip/`,
    cases: [['CIDR membership', "source=test_weblogs | where cidrmatch(host, '1.2.3.0/24')"]],
  },
];

const documentedInvalid: Array<{
  reference: string;
  name: string;
  query: string;
}> = [
  {
    reference: `${docs}/commands/dedup/`,
    name: 'dedup count must be greater than zero',
    query: 'source=test_accounts | dedup 0 gender',
  },
  {
    reference: `${docs}/commands/timechart/`,
    name: 'timechart supports only one aggregation per command',
    query: 'source=test_events | timechart span=1h avg(packets), count() by host',
  },
  {
    reference: `${docs}/commands/sort/`,
    name: 'sort must not mix prefix and suffix notation',
    query: 'source=test_accounts | sort + gender, age desc',
  },
  {
    reference: `${docs}/commands/lookup/`,
    name: 'lookup requires a mapping field',
    query: 'source=test_accounts | lookup test_workers',
  },
  {
    reference: `${docs}/commands/join/`,
    name: 'join requires a right dataset',
    query: 'source=test_accounts | join type=outer id',
  },
  {
    reference: `${docs}/commands/join/`,
    name: 'join subsearch syntax must be validated',
    query: 'source=test_accounts | join id [source=test_workers | where]',
  },
  {
    reference: `${docs}/commands/join/`,
    name: 'join subsearch must close its bracket',
    query: 'source=test_accounts | join id [source=test_workers | head 5',
  },
  {
    reference: `${docs}/commands/streamstats/`,
    name: 'window requires an integer',
    query: 'source=test_accounts | streamstats window=true avg(age)',
  },
  {
    reference: `${docs}/commands/bin/`,
    name: 'bin requires a field',
    query: 'source=test_accounts | bin',
  },
  {
    reference: `${docs}/commands/timechart/`,
    name: 'timechart requires an aggregation',
    query: 'source=test_events | timechart span=1h',
  },
  {
    reference: `${docs}/commands/rex/`,
    name: 'rex extract mode requires a named capture group',
    query: 'source=test_accounts | rex field=email "[^@]+@[^.]+"',
  },
];

describe('OpenSearch 3.5 documented PPL conformance', () => {
  it('checks commands inside documented join subsearches', () => {
    const diagnostics = linter.lint('source=test_accounts | join id [source=test_workers | stat count()]');
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL003')).toBe(true);
  });
  it('reports an inner syntax error once', () => {
    const diagnostics = linter.lint('source=test_accounts | join id [source=test_workers | where]');
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'PPL001')).toHaveLength(1);
  });
  for (const { reference, cases } of suites) {
    describe(reference, () => {
      it.each(cases)('%s', (_name, query) => {
        expect(linter.lint(query), query).toEqual([]);
      });
    });
  }

  for (const { reference, name, query } of documentedInvalid) {
    it(`${reference} rejects ${name}`, () => {
      const errors = linter.lint(query).filter((diagnostic) =>
        diagnostic.severity === 'error' &&
        diagnostic.code !== 'PPL003' &&
        diagnostic.code !== 'PPL008'
      );
      expect(errors, query).not.toEqual([]);
    });
  }
});
