/**
 * Standard PPL built-in functions categorized by domain.
 */

export const AGGREGATION_FUNCTIONS: readonly string[] = [
  'count',
  'avg',
  'sum',
  'min',
  'max',
  'var_pop',
  'var_samp',
  'stddev_pop',
  'stddev_samp',
  'percentile',
  'percentile_approx',
  'dc',
  'distinct_count',
  'distinct_count_approx',
  'first',
  'last',
  'list',
  'values',
  'take',
  'median',
  'per_second',
  'per_minute',
  'per_hour',
  'per_day',
  'span',
  'earliest',
  'latest',
] as const;

export const MATH_FUNCTIONS: readonly string[] = [
  'abs',
  'ceil',
  'ceiling',
  'floor',
  'round',
  'sqrt',
  'cbrt',
  'exp',
  'ln',
  'log',
  'log10',
  'log2',
  'pow',
  'power',
] as const;

export const STRING_FUNCTIONS: readonly string[] = [
  'lower',
  'upper',
  'trim',
  'ltrim',
  'rtrim',
  'concat',
  'concat_ws',
  'length',
  'substr',
  'substring',
  'replace',
  'right',
  'regexp_extract',
  'regexp_match',
  'match_phrase',
  'regexp_replace',
  'like',
  'ilike',
  'position',
] as const;

export const DATETIME_FUNCTIONS: readonly string[] = [
  'now',
  'current_timestamp',
  'date_format',
  'date_add',
  'date_sub',
  'year',
  'month',
  'day',
  'dayname',
  'hour',
  'minute',
  'second',
  'timestampadd',
  'timestampdiff',
  'convert_tz',
  'adddate',
  'date',
  'from_unixtime',
  'unix_timestamp',
  'extract',
  'timestamp',
] as const;

export const ARRAY_FUNCTIONS: readonly string[] = [
  'array_length',
] as const;

export const CONDITIONAL_FUNCTIONS: readonly string[] = [
  'if',
  'case',
  'coalesce',
  'isnull',
  'isnotnull',
  'nullif',
  'ifnull',
  'ispresent',
  'isblank',
  'isempty',
  'cidrmatch',
  'eval',
] as const;

export const TYPE_AND_CRYPTO_FUNCTIONS: readonly string[] = [
  'md5',
  'sha1',
  'sha256',
  'cast',
  'typeof',
] as const;

export const DEFAULT_KNOWN_FUNCTIONS: readonly string[] = [
  ...AGGREGATION_FUNCTIONS,
  ...MATH_FUNCTIONS,
  ...STRING_FUNCTIONS,
  ...ARRAY_FUNCTIONS,
  ...DATETIME_FUNCTIONS,
  ...CONDITIONAL_FUNCTIONS,
  ...TYPE_AND_CRYPTO_FUNCTIONS,
];

export const DEFAULT_KNOWN_FUNCTIONS_SET = new Set<string>(DEFAULT_KNOWN_FUNCTIONS);
