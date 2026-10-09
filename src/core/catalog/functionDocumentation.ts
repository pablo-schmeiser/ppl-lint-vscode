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
import {
  FUNCTION_SIGNATURES,
  FunctionSignature,
  ReturnTypeRule,
  TypeConstraint,
} from './functionSignatures';
import { TokenType } from '../../types';
import { tokenize } from '../lexer/tokenizer';
import {
  ADDITIONAL_MATH_FUNCTIONS,
  STATISTICAL_FUNCTIONS,
} from './additionalMathFunctions';
import { ADDITIONAL_DATETIME_FUNCTIONS } from './additionalDatetimeFunctions';
import { ADDITIONAL_DATA_FUNCTIONS } from './additionalDataFunctions';

const RESEARCHED_FUNCTIONS = [
  ...ADDITIONAL_MATH_FUNCTIONS,
  ...STATISTICAL_FUNCTIONS,
  ...ADDITIONAL_DATETIME_FUNCTIONS,
  ...ADDITIONAL_DATA_FUNCTIONS,
];

export interface FunctionDocumentation {
  name: string;
  category: string;
  description: string;
  syntax: string[];
  returnTypes: string[];
  contexts: string[];
  examples: string[];
  options?: Array<{
    name: string;
    type: string;
  }>;
  docUrl?: string;
  hasSignature: boolean;
}

export interface FunctionHoverInfo {
  documentation: FunctionDocumentation;
  span: {
    start: number;
    end: number;
  };
}

const DOCS_BASE_URL = 'https://docs.opensearch.org/latest/sql-and-ppl/ppl/functions';

const CATEGORIES = [
  {
    name: 'Aggregation',
    functions: AGGREGATION_FUNCTIONS,
    path: 'aggregations',
    description: 'Calculates a summary across rows in a PPL aggregation stage.',
  },
  {
    name: 'Mathematical',
    functions: MATH_FUNCTIONS,
    path: 'math',
    description: 'Applies a mathematical operation to numeric values.',
  },
  {
    name: 'String',
    functions: STRING_FUNCTIONS,
    path: 'string',
    description: 'Transforms or evaluates string values.',
  },
  {
    name: 'Array',
    functions: ARRAY_FUNCTIONS,
    path: 'collection',
    description: 'Calculates or transforms array values.',
  },
  {
    name: 'Date and time',
    functions: DATETIME_FUNCTIONS,
    path: 'datetime',
    description: 'Parses, formats, or calculates date and time values.',
  },
  {
    name: 'Conditional',
    functions: CONDITIONAL_FUNCTIONS,
    path: 'condition',
    description: 'Evaluates conditions or selects values based on null and boolean states.',
  },
  {
    name: 'Type and cryptographic',
    functions: TYPE_AND_CRYPTO_FUNCTIONS,
    path: 'conversion',
    description: 'Converts values or computes a cryptographic digest.',
  },
] as const;

const DOCUMENTATION_OVERRIDES: Record<string, {
  description?: string;
  syntax?: string[];
  examples?: string[];
  category?: {
    name: string;
    path: string;
    description: string;
  };
}> = {
  forall: {
    description: 'Returns whether every array element satisfies a single-parameter boolean lambda.',
    syntax: ['forall(array, element -> condition)'],
    examples: ['| eval positive = forall(array(1, 2, 3), element -> element > 0)'],
  },
  exists: {
    description: 'Returns whether any array element satisfies a single-parameter boolean lambda.',
    syntax: ['exists(array, element -> condition)'],
    examples: ['| eval positive = exists(array(-1, 2), element -> element > 0)'],
  },
  filter: {
    description: 'Keeps array elements that satisfy a single-parameter boolean lambda.',
    syntax: ['filter(array, element -> condition)'],
    examples: ['| eval positive = filter(array(-1, 2), element -> element > 0)'],
  },
  transform: {
    description: 'Transforms each array element using a lambda. An optional second parameter is the zero-based element index.',
    syntax: [
      'transform(array, element -> expression)',
      'transform(array, (element, index) -> expression)',
    ],
    examples: ['| eval shifted = transform(array(1, 2), (element, index) -> element + index)'],
  },
  reduce: {
    description: 'Accumulates array elements using an initial value and a two-parameter lambda, then optionally transforms the accumulator.',
    syntax: ['reduce(array, initial, (accumulator, element) -> expression, [accumulator -> result])'],
    examples: ['| eval total = reduce(array(1, 2, 3), 0, (accumulator, element) -> accumulator + element)'],
  },
  mvmap: {
    description: 'Maps an expression over array elements. The source array field is bound to each element within the expression.',
    syntax: ['mvmap(array, expression)'],
    examples: ['| eval numbers = array(1, 2, 3), scaled = mvmap(numbers, numbers * 10)'],
  },
  mvappend: {
    description: 'Combines values and flattens array arguments into one array, excluding null values.',
    syntax: ['mvappend(value, ...values)'],
    examples: ['| eval combined = mvappend(1, array(2, 3))'],
  },
  split: {
    description: 'Splits a string into an array using a delimiter.',
    syntax: ['split(string, delimiter)'],
    examples: ["| eval parts = split('a;b;c', ';')"],
  },
  mvdedup: {
    description: 'Removes duplicate and null array elements while preserving first-occurrence order.',
    syntax: ['mvdedup(array)'],
    examples: ['| eval unique = mvdedup(array(1, 2, 2, 3))'],
  },
  mvfind: {
    description: 'Returns the zero-based index of the first array element matching a regular expression, or null if none matches.',
    syntax: ['mvfind(array, regex)'],
    examples: ["| eval position = mvfind(array('apple', 'banana'), 'ban.*')"],
  },
  mvindex: {
    description: 'Returns an array element or an inclusive range of elements. Negative indexes count from the end.',
    syntax: ['mvindex(array, start, [end])'],
    examples: ["| eval last = mvindex(array('a', 'b', 'c'), -1)"],
  },
  mvzip: {
    description: 'Joins corresponding elements of two arrays into strings, stopping at the shorter array. The default delimiter is a comma.',
    syntax: ['mvzip(left_array, right_array, [delimiter])'],
    examples: ["| eval pairs = mvzip(array('host1', 'host2'), array('80', '443'), ':')"],
  },
  mvjoin: {
    description: 'Joins string array elements using a delimiter, excluding null elements. Only string arrays are supported.',
    syntax: ['mvjoin(array, delimiter)'],
    examples: ["| eval joined = mvjoin(array('a', 'b', 'c'), ',')"],
  },
  lower: {
    description: 'Converts a string to lowercase.',
  },
  upper: {
    description: 'Converts a string to uppercase.',
  },
  length: {
    description: 'Returns the length of a string in bytes.',
  },
  concat: {
    description: 'Concatenates up to nine strings.',
  },
  var_pop: {
    description: 'Returns the population variance of a numeric expression.',
    examples: ['| stats var_pop(age)'],
  },
  var_samp: {
    description: 'Returns the sample variance of a numeric expression.',
    examples: ['| stats var_samp(age)'],
  },
  stddev_pop: {
    description: 'Returns the population standard deviation of a numeric expression.',
    examples: ['| stats stddev_pop(age)'],
  },
  stddev_samp: {
    description: 'Returns the sample standard deviation of a numeric expression.',
    examples: ['| stats stddev_samp(age)'],
  },
  percentile: {
    description: 'Returns the approximate percentile at the requested percentage.',
    examples: ['| stats percentile(age, 90)'],
  },
  percentile_approx: {
    description: 'Returns the approximate percentile at the requested percentage.',
    examples: ['| stats percentile_approx(age, 90)'],
  },
  median: {
    description: 'Returns the median, or 50th percentile, of a numeric expression.',
    examples: ['| stats median(age)'],
  },
  list: {
    description: 'Collects expression values into an array, preserving duplicates.',
    examples: ['| stats list(firstname)'],
  },
  take: {
    description: 'Returns up to the requested number of values from a field.',
    examples: ['| stats take(firstname, 5)'],
  },
  trim: {
    description: 'Removes leading and trailing spaces from a string.',
    examples: ["| eval clean = trim('  value  ')"],
  },
  ltrim: {
    description: 'Removes leading spaces from a string.',
    examples: ["| eval clean = ltrim('  value')"],
  },
  rtrim: {
    description: 'Removes trailing spaces from a string.',
    examples: ["| eval clean = rtrim('value  ')"],
  },
  concat_ws: {
    description: 'Concatenates two strings with a separator.',
    examples: ["| eval joined = concat_ws('-', 'first', 'second')"],
  },
  substr: {
    description: 'Returns a substring beginning at the requested position.',
    examples: ["| eval part = substr('value', 1, 3)"],
  },
  substring: {
    description: 'Returns a substring beginning at the requested position.',
    examples: ["| eval part = substring('value', 1, 3)"],
  },
  replace: {
    description: 'Replaces regular-expression matches in a string.',
    examples: ["| eval replaced = replace('value', 'a', 'b')"],
  },
  regexp_replace: {
    description: 'Replaces regular-expression matches in a string.',
    examples: ["| eval replaced = regexp_replace('value', 'a', 'b')"],
  },
  like: {
    description: 'Tests a string against a wildcard pattern.',
    examples: ["| eval matches = like(message, 'error%')"],
  },
  ilike: {
    description: 'Tests a string against a case-insensitive wildcard pattern.',
    examples: ["| eval matches = ilike(message, 'error%')"],
  },
  position: {
    description: 'Returns the position of a substring, or zero when it is not found.',
    syntax: ['position(substring IN string)'],
    examples: ["| eval offset = position('error' IN message)"],
  },
  date_add: {
    description: 'Adds an interval to a date, time, or timestamp.',
    syntax: ['date_add(date, INTERVAL amount unit)'],
    examples: ['| eval next_day = date_add(timestamp, INTERVAL 1 DAY)'],
  },
  date_sub: {
    description: 'Subtracts an interval from a date, time, or timestamp.',
    syntax: ['date_sub(date, INTERVAL amount unit)'],
    examples: ['| eval previous_day = date_sub(timestamp, INTERVAL 1 DAY)'],
  },
  adddate: {
    description: 'Adds an interval or a number of days to a date value.',
    syntax: [
      'adddate(date, INTERVAL amount unit)',
      'adddate(date, days)',
    ],
    examples: ['| eval next_day = adddate(date_value, 1)'],
  },
  date: {
    description: 'Constructs a date or extracts the date part of a timestamp.',
  },
  timestamp: {
    description: 'Constructs a timestamp from a date, time, or string value.',
  },
  extract: {
    description: 'Extracts a date or time part as a number.',
    syntax: ['extract(part FROM date)'],
    examples: ['| eval month = extract(MONTH FROM timestamp)'],
  },
  year: {
    description: 'Returns the year component of a date value.',
  },
  month: {
    description: 'Returns the month component of a date value.',
  },
  day: {
    description: 'Returns the day-of-month component of a date value.',
  },
  second: {
    description: 'Returns the seconds component of a time value.',
  },
  cbrt: {
    description: 'Returns the cube root of a numeric value.',
    examples: ['| eval root = cbrt(value)'],
  },
  exp: {
    description: "Returns Euler's number raised to the given power.",
    examples: ['| eval result = exp(value)'],
  },
  ln: {
    description: 'Returns the natural logarithm of a numeric value.',
    examples: ['| eval result = ln(value)'],
  },
  log: {
    description: 'Returns the natural logarithm, or a logarithm with the specified base.',
    examples: ['| eval result = log(base, value)'],
  },
  log10: {
    description: 'Returns the base-10 logarithm of a numeric value.',
    examples: ['| eval result = log10(value)'],
  },
  log2: {
    description: 'Returns the base-2 logarithm of a numeric value.',
    examples: ['| eval result = log2(value)'],
  },
  pow: {
    description: 'Returns the first value raised to the power of the second.',
    examples: ['| eval result = pow(value, 2)'],
  },
  power: {
    description: 'Returns the first value raised to the power of the second.',
    examples: ['| eval result = power(value, 2)'],
  },
  ifnull: {
    description: 'Returns the fallback value when the first expression is null.',
    examples: ["| eval name = ifnull(first_name, 'unknown')"],
  },
  eval: {
    description: 'Evaluates an expression inside an aggregate, for example count(eval(condition)).',
  },
  timestampadd: {
    syntax: ['timestampadd(unit, count, datetime)'],
  },
  timestampdiff: {
    syntax: ['timestampdiff(unit, start, end)'],
  },
  cast: {
    syntax: ['CAST(expression AS type)'],
    category: {
      name: 'Type conversion',
      path: 'conversion',
      description: 'Converts an expression to a PPL data type.',
    },
  },
  md5: {
    examples: ["| eval digest = md5('value')"],
    category: {
      name: 'Cryptographic',
      path: 'cryptographic',
      description: 'Calculates an MD5 digest as a hexadecimal string.',
    },
  },
  sha1: {
    examples: ["| eval digest = sha1('value')"],
    category: {
      name: 'Cryptographic',
      path: 'cryptographic',
      description: 'Calculates a SHA-1 digest as a hexadecimal string.',
    },
  },
  cidrmatch: {
    category: {
      name: 'IP address',
      path: 'ip',
      description: 'Checks whether an IP address belongs to a CIDR range.',
    },
  },
  regexp_match: {
    category: {
      name: 'Conditional',
      path: 'condition',
      description: 'Returns whether a regular expression matches the string.',
    },
  },
  sha256: {
    category: {
      name: 'Cryptographic',
      path: 'cryptographic',
      description: 'Known cryptographic function; its signature has not been verified.',
    },
  },
  typeof: {
    category: {
      name: 'Type conversion',
      path: 'conversion',
      description: 'Known type-related function; its signature has not been verified.',
    },
  },
};

function categoryFor(name: string): {
  name: string;
  path: string;
  description: string;
} | undefined {
  const override = DOCUMENTATION_OVERRIDES[name]?.category;
  if (override) return override;
  const category = CATEGORIES.find((entry) => entry.functions.includes(name));
  return category && {
    name: category.name,
    path: category.path,
    description: category.description,
  };
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
    case 'timeArithmetic': return 'TIME for TIME input; otherwise TIMESTAMP';
    case 'selectedValue': return 'type of the selected argument';
    case 'reduce': return 'accumulator type, or the final lambda result type';
    case 'mvindex': return 'array element type, or ARRAY when end is provided';
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
  const researched = RESEARCHED_FUNCTIONS.find(({ name }) => name === normalized);
  const overrides = DOCUMENTATION_OVERRIDES[normalized];
  const category = researched
    ? {
      name: researched.category,
      path: researched.path,
      description: researched.description,
    }
    : categoryFor(normalized);
  if (!category) return undefined;
  const signatures = FUNCTION_SIGNATURES.get(normalized) ?? [];
  const syntax = researched?.syntax
    ?? overrides?.syntax
    ?? signatures.map(signatureSyntax);
  const returnTypes = normalized === 'cast'
    ? ['target PPL type']
    : [...new Set(signatures.map(({ returnType }) => returnTypeName(returnType)))];
  const contexts = signatures.some((signature) => !signature.contexts)
    ? []
    : [...new Set(signatures.flatMap((signature) => signature.contexts ?? []))];

  return {
    name: normalized,
    category: category.name,
    description: researched?.description
      ?? overrides?.description
      ?? category.description,
    syntax: syntax.length ? syntax : [`${normalized}(...)`],
    returnTypes,
    contexts,
    examples: researched?.examples ?? overrides?.examples ?? [],
    options: signatures.flatMap((signature) =>
      Object.entries(signature.optionalArguments ?? {}).map(([name, constraint]) => ({
        name,
        type: constraintName(constraint),
      }))
    ),
    docUrl: researched
      ? `https://docs.opensearch.org/3.5/sql-and-ppl/ppl/functions/${category.path}/#${normalized}`
      : `${DOCS_BASE_URL}/${category.path}/`,
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
    span: {
      start: token.span.start.offset,
      end: token.span.end.offset,
    },
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
    markdown.push(
      '',
      `**Returns:** ${documentation.returnTypes.map((type) => `\`${type}\``).join(' / ')}`,
    );
  }
  if (documentation.contexts.length) {
    markdown.push(
      '',
      `**Contexts:** ${documentation.contexts.map((context) => `\`${context}\``).join(', ')}`,
    );
  }
  if (documentation.options?.length) {
    markdown.push(
      '',
      '**Named options:**',
      ...documentation.options.map(({ name, type }) => `- \`${name}\`: ${type}`),
    );
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
