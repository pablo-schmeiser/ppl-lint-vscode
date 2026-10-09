import type { DocumentedFunction } from './documentedFunction';
import type { FunctionSignature, TypeConstraint } from './functionSignatures';

type DataFunctionSignature = Omit<FunctionSignature, 'name'>;

function entry(name: string, category: string, path: string, description: string, signature: DataFunctionSignature, syntax: string[], examples: string[]): DocumentedFunction {
  return {
    name, category, path, description,
    signatures: [{ name, ...signature }],
    syntax, examples,
  };
}

function relevance(name: string, description: string, optionalArguments: Record<string, TypeConstraint>, examples: string[], fieldList = false): DocumentedFunction {
  return entry(name, 'Relevance', 'relevance', `${description} Named options use option=value syntax and do not count as positional arguments. Executes only in the OpenSearch query DSL, not in memory; place the where stage immediately after the source stage.`, {
    minArgs: fieldList ? 1 : 2,
    maxArgs: 2,
    arguments: fieldList ? ['any', 'scalar'] : ['stringLike', 'scalar'],
    returnType: 'boolean',
    contexts: ['where'],
    special: 'relevance',
    optionalArguments,
  }, fieldList ? [
    `${name}([field, ...fields], query[, option=value, ...])`,
    `${name}(query[, option=value, ...])`,
  ] : [`${name}(field, query[, option=value, ...])`], examples);
}

const JSON_PATH_DESCRIPTION = 'Paths use key{index}.key notation, not $. Array indices are zero-based; {} or {*} selects all elements.';
const DEFAULT_FIELDS_DESCRIPTION = 'Accepts an explicit field list with optional boosts such as name ^ 2, or a query alone to search index.query.default_field.';

export const ADDITIONAL_DATA_FUNCTIONS: DocumentedFunction[] = [
  entry('tostring', 'Conversion', 'conversion', 'Converts any value to a string. Numeric formats are binary, hex, commas, duration, and duration_millis. Commas rounds to two decimal places; duration formats seconds as HH:MM:SS, while duration_millis uses milliseconds. Boolean values become TRUE or FALSE and ignore the format.', {
    minArgs: 1, maxArgs: 2, arguments: ['any', 'string'], returnType: 'string',
    allowedValues: { 1: ['binary', 'hex', 'commas', 'duration', 'duration_millis'] },
  }, ['tostring(value[, format])'], [
    '| eval result = tostring(true)',
    "| eval result = tostring(255, 'hex')",
    "| eval result = tostring(6500, 'duration')",
  ]),
  entry('tonumber', 'Conversion', 'conversion', 'Converts a string to a double, using base 10 by default. The optional integer base must be between 2 and 36. Returns NULL when parsing fails. Supported only in eval expressions.', {
    minArgs: 1, maxArgs: 2, arguments: ['string', 'integer'], returnType: 'double',
    contexts: ['eval'], integerRanges: { 1: [2, 36] },
  }, ['tonumber(string[, base])'], [
    "| eval result = tonumber('4598.678')",
    "| eval result = tonumber('FA34', 16)",
  ]),
  entry('sha2', 'Cryptographic', 'cryptographic', 'Returns a SHA-2 hash as a hexadecimal string. The bit length must be 224, 256, 384, or 512.', {
    minArgs: 2, maxArgs: 2, arguments: ['string', 'integer'], returnType: 'string',
    allowedValues: { 1: [224, 256, 384, 512] },
  }, ['sha2(string, bits)'], ["| eval result = sha2('hello', 256)"]),
  entry('locate', 'String', 'string', 'Returns the one-based position of the first substring occurrence, or 0 if missing. The optional starting position defaults to 1. Returns NULL if any argument is NULL.', {
    minArgs: 2, maxArgs: 3, arguments: ['string', 'string', 'integer'], returnType: 'int',
  }, ['locate(substring, string[, start])'], ["| eval result = locate('world', 'helloworld', 6)"]),
  entry('reverse', 'String', 'string', 'Returns the characters of a string in reverse order.', {
    minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string',
  }, ['reverse(string)'], ["| eval result = reverse('abcde')"]),
  entry('geoip', 'IP', 'ip', 'Returns location information as a struct for an IPv4 or IPv6 address. Requires the OpenSearch Geospatial plugin and an established data source. The optional comma-separated output field list depends on the data source schema.', {
    minArgs: 2, maxArgs: 3, arguments: ['string', 'stringLike', 'string'], returnType: 'struct',
  }, ['geoip(dataSourceName, ipAddress[, options])'], ["| eval result = geoip('dataSourceName', '50.68.18.229', 'country_iso_code,city_name')"]),
  entry('typeof', 'System', 'system', 'Returns the data type of any expression as a string.', {
    minArgs: 1, maxArgs: 1, arguments: ['any'], returnType: 'string',
  }, ['typeof(expression)'], ['| eval result = typeof(1)']),
  entry('json', 'JSON', 'json', 'Validates and parses a JSON string, returning its JSON string representation or NULL if invalid.', {
    minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string',
  }, ['json(value)'], ["| eval result = json('{\"a\":1}')"]),
  entry('json_valid', 'JSON', 'json', 'Returns true for valid JSON syntax and false for invalid JSON. NULL input returns NULL. Requires OpenSearch 3.1 or later with plugins.calcite.enabled=true.', {
    minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'boolean',
  }, ['json_valid(value)'], ["| eval result = json_valid('[1,2,3]')"]),
  entry('json_object', 'JSON', 'json', 'Creates a JSON object string from one or more key-value pairs. Keys must be strings; values may have any type.', {
    minArgs: 2, arguments: ['string', 'any'], variadic: 'any', returnType: 'string',
    argumentPairs: { start: 0, key: 'string' },
  }, ['json_object(key, value[, key, value, ...])'], ["| eval result = json_object('a', 1, 'b', true)"]),
  entry('json_array', 'JSON', 'json', 'Creates a JSON array string from zero or more values of any type.', {
    minArgs: 0, arguments: [], variadic: 'any', returnType: 'string',
  }, ['json_array([value, ...])'], [
    '| eval result = json_array()',
    "| eval result = json_array('a', 1, true)",
  ]),
  entry('json_array_length', 'JSON', 'json', 'Returns the number of elements in a JSON array string. Returns NULL for invalid JSON, non-array JSON, or NULL input.', {
    minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'int',
  }, ['json_array_length(value)'], ["| eval result = json_array_length('[1,2,3]')"]),
  entry('json_extract', 'JSON', 'json', `Extracts values from a JSON string. A single path returns its value; multiple paths return a JSON array in path order. Invalid paths return NULL for that path. ${JSON_PATH_DESCRIPTION}`, {
    minArgs: 2, arguments: ['string', 'string'], variadic: 'string', returnType: 'string',
  }, ['json_extract(json_string, path[, path, ...])'], ["| eval result = json_extract('{\"a\":[{\"b\":1},{\"b\":2}]}', 'a{}.b')"]),
  entry('json_delete', 'JSON', 'json', `Deletes values at one or more paths and returns the modified JSON string. Missing paths leave the input unchanged. ${JSON_PATH_DESCRIPTION}`, {
    minArgs: 2, arguments: ['string', 'string'], variadic: 'string', returnType: 'string',
  }, ['json_delete(json_string, path[, path, ...])'], ["| eval result = json_delete('{\"a\":[{\"b\":1},{\"b\":2}]}', 'a{0}.b', 'a{1}.b')"]),
  entry('json_set', 'JSON', 'json', `Sets values using one or more path-value pairs and returns the modified JSON string. Skips paths whose parent is not an object. ${JSON_PATH_DESCRIPTION}`, {
    minArgs: 3, arguments: ['string', 'string', 'any'], variadic: 'any', returnType: 'string',
    argumentPairs: { start: 1, key: 'string' },
  }, ['json_set(json_string, path, value[, path, value, ...])'], ["| eval result = json_set('{\"a\":[{\"b\":1}]}', 'a{0}.b', 3)"]),
  entry('json_append', 'JSON', 'json', `Appends values to arrays using one or more path-value pairs and returns the modified JSON string. Skips non-array targets. ${JSON_PATH_DESCRIPTION}`, {
    minArgs: 3, arguments: ['string', 'string', 'any'], variadic: 'any', returnType: 'string',
    argumentPairs: { start: 1, key: 'string' },
  }, ['json_append(json_string, path, value[, path, value, ...])'], ["| eval result = json_append('{\"a\":[1,2]}', 'a', 3)"]),
  entry('json_extend', 'JSON', 'json', `Extends arrays using one or more path-value pairs and returns the modified JSON string. Parses each value as an array and adds its elements when successful; otherwise adds the value as one element. Skips non-array targets. ${JSON_PATH_DESCRIPTION}`, {
    minArgs: 3, arguments: ['string', 'string', 'any'], variadic: 'any', returnType: 'string',
    argumentPairs: { start: 1, key: 'string' },
  }, ['json_extend(json_string, path, value[, path, value, ...])'], ["| eval result = json_extend('{\"a\":[1]}', 'a', '[2,3]')"]),
  entry('json_keys', 'JSON', 'json', 'Returns the top-level keys of a JSON object as a JSON array string. Returns NULL if the input is not a valid JSON object.', {
    minArgs: 1, maxArgs: 1, arguments: ['string'], returnType: 'string',
  }, ['json_keys(json_string)'], ["| eval result = json_keys('{\"a\":1,\"b\":2}')"]),
  relevance('match', 'Matches a field against text, a number, a date, or a Boolean value.', {
    analyzer: 'string',
    auto_generate_synonyms_phrase: 'boolean',
    fuzziness: 'numericOrString',
    max_expansions: 'integer',
    prefix_length: 'integer',
    fuzzy_transpositions: 'boolean',
    fuzzy_rewrite: 'string',
    lenient: 'boolean',
    operator: 'string',
    minimum_should_match: 'numericOrString',
    zero_terms_query: 'string',
    boost: 'numeric',
  }, [
    "| where match(name, 'Hattie')",
    "| where match(name, 'Hattie', operator='AND', boost=2.0)",
  ]),
  relevance('match_phrase', 'Matches text as an ordered phrase within a field.', {
    analyzer: 'string',
    slop: 'integer',
    zero_terms_query: 'string',
  }, ["| where match_phrase(name, 'Alan Milne', slop=2)"]),
  relevance('match_phrase_prefix', 'Matches a phrase in a field, treating its last term as a prefix.', {
    analyzer: 'string',
    slop: 'integer',
    max_expansions: 'integer',
    boost: 'numeric',
    zero_terms_query: 'string',
  }, [
    "| where match_phrase_prefix(name, 'Alexander Mil')",
    "| where match_phrase_prefix(name, 'Alan Mil', slop=2)",
  ]),
  relevance('multi_match', `Matches one or more fields against text, a number, a date, or a Boolean value. ${DEFAULT_FIELDS_DESCRIPTION}`, {
    analyzer: 'string',
    auto_generate_synonyms_phrase: 'boolean',
    cutoff_frequency: 'numeric',
    fuzziness: 'numericOrString',
    fuzzy_transpositions: 'boolean',
    lenient: 'boolean',
    max_expansions: 'integer',
    minimum_should_match: 'numericOrString',
    operator: 'string',
    prefix_length: 'integer',
    tie_breaker: 'numeric',
    type: 'string',
    slop: 'integer',
    boost: 'numeric',
  }, [
    "| where multi_match('Pooh House')",
    "| where multi_match([name], 'Pooh House')",
    "| where multi_match([name ^ 2, '*'], 'Pooh House', operator='AND', analyzer='default')",
  ], true),
  relevance('simple_query_string', `Searches with simple query-string operators. ${DEFAULT_FIELDS_DESCRIPTION}`, {
    analyze_wildcard: 'boolean',
    analyzer: 'string',
    auto_generate_synonyms_phrase: 'boolean',
    flags: 'string',
    fuzziness: 'numericOrString',
    fuzzy_max_expansions: 'integer',
    fuzzy_prefix_length: 'integer',
    fuzzy_transpositions: 'boolean',
    lenient: 'boolean',
    default_operator: 'string',
    minimum_should_match: 'numericOrString',
    quote_field_suffix: 'string',
    boost: 'numeric',
  }, [
    "| where simple_query_string('Pooh House')",
    "| where simple_query_string([name], 'Pooh House')",
    "| where simple_query_string([name ^ 2, '*'], 'Pooh House', flags='ALL', default_operator='AND')",
  ], true),
  relevance('match_bool_prefix', 'Matches terms in a field, treating all terms except the last as exact terms and the last as a prefix.', {
    analyzer: 'string',
    fuzziness: 'numericOrString',
    max_expansions: 'integer',
    prefix_length: 'integer',
    fuzzy_transpositions: 'boolean',
    operator: 'string',
    fuzzy_rewrite: 'string',
    minimum_should_match: 'numericOrString',
    boost: 'numeric',
  }, [
    "| where match_bool_prefix(name, 'Alan Mil')",
    "| where match_bool_prefix(name, 'Alan Mil', minimum_should_match=2)",
  ]),
  relevance('query_string', `Searches with query-string syntax, including Boolean operators, wildcards, and field-qualified terms. ${DEFAULT_FIELDS_DESCRIPTION}`, {
    analyzer: 'string',
    escape: 'boolean',
    allow_leading_wildcard: 'boolean',
    analyze_wildcard: 'boolean',
    auto_generate_synonyms_phrase_query: 'boolean',
    boost: 'numeric',
    default_operator: 'string',
    enable_position_increments: 'boolean',
    fuzziness: 'numericOrString',
    fuzzy_max_expansions: 'integer',
    fuzzy_prefix_length: 'integer',
    fuzzy_transpositions: 'boolean',
    fuzzy_rewrite: 'string',
    tie_breaker: 'numeric',
    lenient: 'boolean',
    type: 'string',
    max_determinized_states: 'integer',
    minimum_should_match: 'numericOrString',
    quote_analyzer: 'string',
    phrase_slop: 'integer',
    quote_field_suffix: 'string',
    rewrite: 'string',
    time_zone: 'string',
  }, [
    "| where query_string('Pooh House')",
    "| where query_string([name], 'Pooh House')",
    "| where query_string([name ^ 2, '*'], 'Pooh House', default_operator='AND')",
  ], true),
];
