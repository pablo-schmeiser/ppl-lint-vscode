import { PplType } from '../pplTypes';

export type TypeConstraint = 'any' | 'numeric' | 'string' | 'stringLike' | 'boolean' | 'temporal' | 'array';
export type ReturnTypeRule = PplType | 'sameAsFirst' | 'common' | 'if' | 'case' | 'widerNumeric' | 'fromUnixTime' | 'earliestLatest' | 'addDate' | 'unknown';

export interface FunctionSignature {
  name: string;
  minArgs: number;
  maxArgs?: number;
  arguments: TypeConstraint[];
  variadic?: TypeConstraint;
  returnType: ReturnTypeRule;
  contexts?: readonly string[];
  constantArguments?: readonly number[];
  special?: 'case';
}

const signatures: FunctionSignature[] = [
  { name: 'abs', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'sameAsFirst' },
  { name: 'ceil', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'sameAsFirst' },
  { name: 'ceiling', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'sameAsFirst' },
  { name: 'floor', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'sameAsFirst' },
  { name: 'round', minArgs: 1, maxArgs: 2, arguments: ['numeric', 'numeric'], returnType: 'sameAsFirst' },
  { name: 'sqrt', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double' },
  { name: 'cbrt', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double' },
  { name: 'exp', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double' },
  { name: 'ln', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double' },
  { name: 'log', minArgs: 1, maxArgs: 2, arguments: ['numeric', 'numeric'], returnType: 'double' },
  { name: 'log10', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double' },
  { name: 'log2', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double' },
  { name: 'pow', minArgs: 2, maxArgs: 2, arguments: ['numeric', 'numeric'], returnType: 'double' },
  { name: 'power', minArgs: 2, maxArgs: 2, arguments: ['numeric', 'numeric'], returnType: 'double' },
  { name: 'length', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'int' },
  { name: 'lower', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string' },
  { name: 'upper', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string' },
  { name: 'trim', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string' },
  { name: 'ltrim', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string' },
  { name: 'rtrim', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string' },
  { name: 'concat_ws', minArgs: 3, maxArgs: 3, arguments: ['string', 'string', 'string'], returnType: 'string' },
  { name: 'substr', minArgs: 2, maxArgs: 3, arguments: ['string', 'numeric', 'numeric'], returnType: 'string' },
  { name: 'substring', minArgs: 2, maxArgs: 3, arguments: ['string', 'numeric', 'numeric'], returnType: 'string' },
  { name: 'replace', minArgs: 3, maxArgs: 3, arguments: ['string', 'string', 'string'], returnType: 'string' },
  { name: 'regexp_replace', minArgs: 3, maxArgs: 3, arguments: ['string', 'string', 'string'], returnType: 'string' },
  { name: 'like', minArgs: 2, maxArgs: 3, arguments: ['string', 'string', 'boolean'], returnType: 'boolean' },
  { name: 'ilike', minArgs: 2, maxArgs: 2, arguments: ['string', 'string'], returnType: 'boolean' },
  { name: 'position', minArgs: 2, maxArgs: 2, arguments: ['string', 'string'], returnType: 'int' },
  { name: 'isnull', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'boolean' },
  { name: 'isnotnull', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'boolean' },
  { name: 'ispresent', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'boolean' },
  { name: 'isblank', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'boolean' },
  { name: 'isempty', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'boolean' },
  { name: 'if', minArgs: 3, maxArgs: 3, arguments: ['boolean', 'any', 'any'], returnType: 'if' },
  { name: 'case', minArgs: 2, arguments: ['boolean', 'any'], variadic: 'any', returnType: 'case', special: 'case' },
  { name: 'coalesce', minArgs: 1, arguments: ['any'], variadic: 'any', returnType: 'common' },
  { name: 'ifnull', minArgs: 2, maxArgs: 2, arguments: ['any', 'any'], returnType: 'common' },
  { name: 'eval', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'count', minArgs: 0, maxArgs: 1, arguments: ['any'], returnType: 'bigint', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'sum', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'sum', minArgs: 1, arguments: ['numeric'], variadic: 'numeric', returnType: 'widerNumeric', contexts: ['eval'] },
  { name: 'avg', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'avg', minArgs: 1, arguments: ['numeric'], variadic: 'numeric', returnType: 'double', contexts: ['eval'] },
  { name: 'max', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'min', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'first', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats'] },
  { name: 'last', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats'] },
  { name: 'var_pop', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'var_samp', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'stddev_pop', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'stddev_samp', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'double', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'distinct_count', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'bigint', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'distinct_count_approx', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'bigint', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'dc', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'bigint', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'percentile', minArgs: 2, maxArgs: 2, arguments: ['numeric', 'numeric'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'percentile_approx', minArgs: 2, maxArgs: 2, arguments: ['numeric', 'numeric'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'median', minArgs: 1, maxArgs: 1, arguments: ['numeric'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats', 'timechart'] },
  { name: 'list', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'array', contexts: ['stats', 'eventstats', 'streamstats'] },
  { name: 'take', minArgs: 1, maxArgs: 2, arguments: ['any', 'numeric'], returnType: 'array', contexts: ['stats', 'eventstats', 'streamstats'] },
  { name: 'regexp_match', minArgs: 2, maxArgs: 2, arguments: ['string', 'string'], returnType: 'boolean' },
  { name: 'match_phrase', minArgs: 2, maxArgs: 2, arguments: ['string', 'string'], returnType: 'boolean' },
  { name: 'md5', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string' },
  { name: 'sha1', minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string' },
  { name: 'date_format', minArgs: 2, maxArgs: 2, arguments: ['temporal', 'string'], returnType: 'string' },
  { name: 'convert_tz', minArgs: 3, maxArgs: 3, arguments: ['temporal', 'string', 'string'], returnType: 'timestamp' },
  { name: 'now', minArgs: 0, maxArgs: 0, arguments: [], returnType: 'timestamp' },
  { name: 'current_timestamp', minArgs: 0, maxArgs: 0, arguments: [], returnType: 'timestamp' },
  { name: 'hour', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'int' },
  { name: 'minute', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'int' },
  { name: 'dayname', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'string' },
  { name: 'year', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'int' },
  { name: 'month', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'int' },
  { name: 'day', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'int' },
  { name: 'second', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'int' },
  { name: 'date', minArgs: 1, maxArgs: 1, arguments: ['temporal'], returnType: 'date' },
  { name: 'timestamp', minArgs: 1, maxArgs: 2, arguments: ['temporal', 'temporal'], returnType: 'timestamp' },
  { name: 'extract', minArgs: 2, maxArgs: 2, arguments: ['any', 'temporal'], returnType: 'bigint', constantArguments: [0] },
  { name: 'date_add', minArgs: 2, maxArgs: 2, arguments: ['temporal', 'any'], returnType: 'timestamp' },
  { name: 'date_sub', minArgs: 2, maxArgs: 2, arguments: ['temporal', 'any'], returnType: 'timestamp' },
  { name: 'adddate', minArgs: 2, maxArgs: 2, arguments: ['temporal', 'any'], returnType: 'addDate' },
  { name: 'array_length', minArgs: 1, maxArgs: 1, arguments: ['array'], returnType: 'int' },
  { name: 'span', minArgs: 2, maxArgs: 2, arguments: ['any', 'any'], returnType: 'sameAsFirst', contexts: ['stats', 'eventstats', 'streamstats'] },
  { name: 'timestampadd', minArgs: 3, maxArgs: 3, arguments: ['any', 'numeric', 'temporal'], returnType: 'timestamp', constantArguments: [0] },
  { name: 'timestampdiff', minArgs: 3, maxArgs: 3, arguments: ['any', 'temporal', 'temporal'], returnType: 'bigint', constantArguments: [0] },
  { name: 'concat', minArgs: 1, maxArgs: 9, arguments: ['string'], variadic: 'string', returnType: 'string' },
  { name: 'cidrmatch', minArgs: 2, maxArgs: 2, arguments: ['stringLike', 'stringLike'], returnType: 'boolean' },
  { name: 'right', minArgs: 2, maxArgs: 2, arguments: ['string', 'numeric'], returnType: 'string' },
  { name: 'unix_timestamp', minArgs: 0, maxArgs: 1, arguments: ['temporal'], returnType: 'double' },
  { name: 'from_unixtime', minArgs: 1, maxArgs: 2, arguments: ['numeric', 'string'], returnType: 'fromUnixTime' },
  { name: 'nullif', minArgs: 2, maxArgs: 2, arguments: ['any', 'any'], returnType: 'sameAsFirst' },
  { name: 'values', minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'array', contexts: ['stats', 'eventstats', 'streamstats'] },
  { name: 'earliest', minArgs: 2, maxArgs: 2, arguments: ['string', 'temporal'], returnType: 'boolean', contexts: ['eval', 'where'] },
  { name: 'earliest', minArgs: 1, maxArgs: 2, arguments: ['any', 'temporal'], returnType: 'earliestLatest', contexts: ['stats', 'eventstats', 'streamstats'] },
  { name: 'latest', minArgs: 2, maxArgs: 2, arguments: ['string', 'temporal'], returnType: 'boolean', contexts: ['eval', 'where'] },
  { name: 'latest', minArgs: 1, maxArgs: 2, arguments: ['any', 'temporal'], returnType: 'earliestLatest', contexts: ['stats', 'eventstats', 'streamstats'] },
];

export const FUNCTION_SIGNATURES = new Map<string, FunctionSignature[]>();
for (const signature of signatures) {
  const overloads = FUNCTION_SIGNATURES.get(signature.name) || [];
  overloads.push(signature);
  FUNCTION_SIGNATURES.set(signature.name, overloads);
}

export function getFunctionSignature(name: string, context?: string): FunctionSignature | undefined {
  const overloads = FUNCTION_SIGNATURES.get(name.toLowerCase());
  if (!overloads) return undefined;
  return overloads.find((signature) => !signature.contexts || !context || signature.contexts.includes(context.toLowerCase()));
}

export function argumentConstraint(signature: FunctionSignature, index: number): TypeConstraint | undefined {
  return signature.arguments[index] ?? signature.variadic;
}