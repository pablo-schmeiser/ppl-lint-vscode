import {
  AGGREGATION_FUNCTIONS,
  ARRAY_FUNCTIONS,
  CONDITIONAL_FUNCTIONS,
  DATETIME_FUNCTIONS,
  DEFAULT_KNOWN_FUNCTIONS,
  MATH_FUNCTIONS,
  STRING_FUNCTIONS,
  TYPE_AND_CRYPTO_FUNCTIONS,
} from './functions';
import { FUNCTION_SIGNATURES, FunctionSignature, ReturnTypeRule, TypeConstraint } from './functionSignatures';
import { TokenType } from '../../types';
import { tokenize } from '../lexer/tokenizer';

export interface FunctionDocumentation {
  name: string;
  category: string;
  description: string;
  syntax: string[];
  returnTypes: string[];
  contexts: string[];
  examples: string[];
  docUrl?: string;
  hasSignature: boolean;
}

export interface FunctionHoverInfo {
  documentation: FunctionDocumentation;
  span: { start: number; end: number };
}

const DOCS_BASE_URL = 'https://docs.opensearch.org/latest/sql-and-ppl/ppl/functions';

const CATEGORIES = [
  { name: 'Aggregation', functions: AGGREGATION_FUNCTIONS, path: 'aggregations', description: 'Calculates a summary across rows in a PPL aggregation stage.' },
  { name: 'Mathematical', functions: MATH_FUNCTIONS, path: 'math', description: 'Applies a mathematical operation to numeric values.' },
  { name: 'String', functions: STRING_FUNCTIONS, path: 'string', description: 'Transforms or evaluates string values.' },
  { name: 'Array', functions: ARRAY_FUNCTIONS, path: 'collection', description: 'Calculates or transforms array values.' },
  { name: 'Date and time', functions: DATETIME_FUNCTIONS, path: 'datetime', description: 'Parses, formats, or calculates date and time values.' },
  { name: 'Conditional', functions: CONDITIONAL_FUNCTIONS, path: 'condition', description: 'Evaluates conditions or selects values based on null and boolean states.' },
  { name: 'Type and cryptographic', functions: TYPE_AND_CRYPTO_FUNCTIONS, path: 'conversion', description: 'Converts values or computes a cryptographic digest.' },
] as const;

const CATEGORY_OVERRIDES: Record<string, { name: string; path: string; description: string }> = {
  cidrmatch: { name: 'IP address', path: 'ip', description: 'Checks whether an IP address belongs to a CIDR range.' },
  regexp_match: { name: 'Conditional', path: 'condition', description: 'Returns whether a regular expression matches the string.' },
  md5: { name: 'Cryptographic', path: 'cryptographic', description: 'Calculates an MD5 digest as a hexadecimal string.' },
  sha1: { name: 'Cryptographic', path: 'cryptographic', description: 'Calculates a SHA-1 digest as a hexadecimal string.' },
  sha256: { name: 'Cryptographic', path: 'cryptographic', description: 'Known cryptographic function; its signature has not been verified.' },
  cast: { name: 'Type conversion', path: 'conversion', description: 'Converts an expression to a PPL data type.' },
  typeof: { name: 'Type conversion', path: 'conversion', description: 'Known type-related function; its signature has not been verified.' },
};

const DESCRIPTIONS: Record<string, string> = {
  lower: 'Converts a string to lowercase.',
  upper: 'Converts a string to uppercase.',
  length: 'Returns the length of a string in bytes.',
  concat: 'Concatenates up to nine strings.',
  var_pop: 'Returns the population variance of a numeric expression.',
  var_samp: 'Returns the sample variance of a numeric expression.',
  stddev_pop: 'Returns the population standard deviation of a numeric expression.',
  stddev_samp: 'Returns the sample standard deviation of a numeric expression.',
  percentile: 'Returns the approximate percentile at the requested percentage.',
  percentile_approx: 'Returns the approximate percentile at the requested percentage.',
  median: 'Returns the median, or 50th percentile, of a numeric expression.',
  list: 'Collects expression values into an array, preserving duplicates.',
  take: 'Returns up to the requested number of values from a field.',
  trim: 'Removes leading and trailing spaces from a string.',
  ltrim: 'Removes leading spaces from a string.',
  rtrim: 'Removes trailing spaces from a string.',
  concat_ws: 'Concatenates two strings with a separator.',
  substr: 'Returns a substring beginning at the requested position.',
  substring: 'Returns a substring beginning at the requested position.',
  replace: 'Replaces regular-expression matches in a string.',
  regexp_replace: 'Replaces regular-expression matches in a string.',
  like: 'Tests a string against a wildcard pattern.',
  ilike: 'Tests a string against a case-insensitive wildcard pattern.',
  position: 'Returns the position of a substring, or zero when it is not found.',
  date_add: 'Adds an interval to a date, time, or timestamp.',
  date_sub: 'Subtracts an interval from a date, time, or timestamp.',
  adddate: 'Adds an interval or a number of days to a date value.',
  date: 'Constructs a date or extracts the date part of a timestamp.',
  timestamp: 'Constructs a timestamp from a date, time, or string value.',
  extract: 'Extracts a date or time part as a number.',
  year: 'Returns the year component of a date value.',
  month: 'Returns the month component of a date value.',
  day: 'Returns the day-of-month component of a date value.',
  second: 'Returns the seconds component of a time value.',
  cbrt: 'Returns the cube root of a numeric value.',
  exp: "Returns Euler's number raised to the given power.",
  ln: 'Returns the natural logarithm of a numeric value.',
  log: 'Returns the natural logarithm, or a logarithm with the specified base.',
  log10: 'Returns the base-10 logarithm of a numeric value.',
  log2: 'Returns the base-2 logarithm of a numeric value.',
  pow: 'Returns the first value raised to the power of the second.',
  power: 'Returns the first value raised to the power of the second.',
  ifnull: 'Returns the fallback value when the first expression is null.',
  eval: 'Evaluates an expression inside an aggregate, for example count(eval(condition)).',
};

const SYNTAX_OVERRIDES: Record<string, string[]> = {
  adddate: ['adddate(date, INTERVAL amount unit)', 'adddate(date, days)'],
  date_add: ['date_add(date, INTERVAL amount unit)'],
  date_sub: ['date_sub(date, INTERVAL amount unit)'],
  extract: ['extract(part FROM date)'],
  position: ['position(substring IN string)'],
  timestampadd: ['timestampadd(unit, count, datetime)'],
  timestampdiff: ['timestampdiff(unit, start, end)'],
  cast: ['CAST(expression AS type)'],
};

const EXAMPLES: Record<string, string[]> = {
  var_pop: ['| stats var_pop(age)'],
  var_samp: ['| stats var_samp(age)'],
  stddev_pop: ['| stats stddev_pop(age)'],
  stddev_samp: ['| stats stddev_samp(age)'],
  percentile: ['| stats percentile(age, 90)'],
  percentile_approx: ['| stats percentile_approx(age, 90)'],
  median: ['| stats median(age)'],
  list: ['| stats list(firstname)'],
  take: ['| stats take(firstname, 5)'],
  trim: ["| eval clean = trim('  value  ')"],
  ltrim: ["| eval clean = ltrim('  value')"],
  rtrim: ["| eval clean = rtrim('value  ')"],
  concat_ws: ["| eval joined = concat_ws('-', 'first', 'second')"],
  substr: ["| eval part = substr('value', 1, 3)"],
  substring: ["| eval part = substring('value', 1, 3)"],
  replace: ["| eval replaced = replace('value', 'a', 'b')"],
  regexp_replace: ["| eval replaced = regexp_replace('value', 'a', 'b')"],
  like: ["| eval matches = like(message, 'error%')"],
  ilike: ["| eval matches = ilike(message, 'error%')"],
  position: ["| eval offset = position('error' IN message)"],
  date_add: ['| eval next_day = date_add(timestamp, INTERVAL 1 DAY)'],
  date_sub: ['| eval previous_day = date_sub(timestamp, INTERVAL 1 DAY)'],
  adddate: ['| eval next_day = adddate(date_value, 1)'],
  extract: ['| eval month = extract(MONTH FROM timestamp)'],
  cbrt: ['| eval root = cbrt(value)'],
  exp: ['| eval result = exp(value)'],
  ln: ['| eval result = ln(value)'],
  log: ['| eval result = log(base, value)'],
  log10: ['| eval result = log10(value)'],
  log2: ['| eval result = log2(value)'],
  pow: ['| eval result = pow(value, 2)'],
  power: ['| eval result = power(value, 2)'],
  ifnull: ["| eval name = ifnull(first_name, 'unknown')"],
  md5: ["| eval digest = md5('value')"],
  sha1: ["| eval digest = sha1('value')"],
};

function categoryFor(name: string): { name: string; path: string; description: string } | undefined {
  const override = CATEGORY_OVERRIDES[name];
  if (override) return override;
  const category = CATEGORIES.find((entry) => entry.functions.includes(name));
  return category && { name: category.name, path: category.path, description: category.description };
}

function constraintName(constraint: TypeConstraint): string {
  switch (constraint) {
    case 'numeric': return 'number';
    case 'stringLike': return 'string or IP';
    case 'temporal': return 'date/time';
    default: return constraint;
  }
}

function signatureSyntax(signature: FunctionSignature): string {
  const args = signature.arguments.map((constraint, index) => {
    const type = signature.constantArguments?.includes(index)
      ? 'unit'
      : constraintName(constraint);
    return index >= signature.minArgs ? `[${type}]` : type;
  });
  if (signature.variadic) args.push(`...${constraintName(signature.variadic)}`);
  return `${signature.name}(${args.join(', ')})`;
}

function returnTypeName(returnType: ReturnTypeRule): string {
  switch (returnType) {
    case 'sameAsFirst': return 'same type as the first argument';
    case 'common': return 'least restrictive common type';
    case 'case': return 'least restrictive common type of result branches';
    case 'widerNumeric': return 'widest numeric argument type';
    case 'fromUnixTime': return 'TIMESTAMP or STRING when a format is supplied';
    case 'earliestLatest': return 'same type as the field argument';
    case 'addDate': return 'DATE for a day offset on DATE input; otherwise TIMESTAMP';
    case 'unknown': return 'not inferred';
    default: return returnType.toUpperCase();
  }
}

export function functionDocumentation(name: string): FunctionDocumentation | undefined {
  const normalized = name.toLowerCase();
  if (!DEFAULT_KNOWN_FUNCTIONS.includes(normalized)) return undefined;
  const category = categoryFor(normalized);
  if (!category) return undefined;
  const signatures = FUNCTION_SIGNATURES.get(normalized) ?? [];
  const syntax = SYNTAX_OVERRIDES[normalized] ?? signatures.map(signatureSyntax);
  const returnTypes = normalized === 'cast'
    ? ['target PPL type']
    : [...new Set(signatures.map(({ returnType }) => returnTypeName(returnType)))];
  const contexts = signatures.some((signature) => !signature.contexts)
    ? []
    : [...new Set(signatures.flatMap((signature) => signature.contexts ?? []))];

  return {
    name: normalized,
    category: category.name,
    description: DESCRIPTIONS[normalized] ?? category.description,
    syntax: syntax.length ? syntax : [`${normalized}(...)`],
    returnTypes,
    contexts,
    examples: EXAMPLES[normalized] ?? [],
    docUrl: `${DOCS_BASE_URL}/${category.path}/`,
    hasSignature: signatures.length > 0 || normalized === 'cast',
  };
}

export function functionInfoAt(query: string, offset: number): FunctionHoverInfo | undefined {
  const tokens = tokenize(query);
  const index = tokens.findIndex((token) =>
    token.span.start.offset <= offset && offset < token.span.end.offset
  );
  if (index < 0 || tokens[index + 1]?.type !== TokenType.LPAREN) return undefined;
  const token = tokens[index];
  const documentation = functionDocumentation(token.value);
  if (!documentation) return undefined;
  return {
    documentation,
    span: { start: token.span.start.offset, end: token.span.end.offset },
  };
}

export function renderFunctionDocumentation(documentation: FunctionDocumentation): string {
  const markdown = [
    `### PPL Function: \`${documentation.name}\``,
    '',
    documentation.description,
    '',
    `**Category:** ${documentation.category}`,
    '',
    '**Syntax:**',
    ...documentation.syntax.map((syntax) => `- \`${syntax}\``),
  ];
  if (documentation.returnTypes.length) {
    markdown.push('', `**Returns:** ${documentation.returnTypes.map((type) => `\`${type}\``).join(' / ')}`);
  }
  if (documentation.contexts.length) {
    markdown.push('', `**Contexts:** ${documentation.contexts.map((context) => `\`${context}\``).join(', ')}`);
  }
  if (documentation.examples.length) {
    markdown.push('', '**Example:**', '', '```ppl', ...documentation.examples, '```');
  }
  if (!documentation.hasSignature) {
    markdown.push('', 'Argument and return-type validation are not implemented for this function.');
  }
  if (documentation.docUrl) {
    markdown.push('', `[OpenSearch PPL reference](${documentation.docUrl})`);
  }
  return markdown.join('\n');
}