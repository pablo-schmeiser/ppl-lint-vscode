import { describe, expect, it } from 'vitest';
import { completionCandidates } from '../../src/core/completion';
import { functionDocumentation } from '../../src/core/catalog/functionDocumentation';
import { ARRAY_FUNCTIONS, DEFAULT_KNOWN_FUNCTIONS } from '../../src/core/catalog/functions';
import { parseIndexTemplates } from '../../src/core/indexTemplates';
import { PplLinter } from '../../src/core/linter';
import { typedFieldScopeAt } from '../../src/core/schemaTypeChecker';
import {
  FUNCTION_SIGNATURES,
  getFunctionSignature,
} from '../../src/core/catalog/functionSignatures';

const FUNCTIONS_WITHOUT_SIGNATURES = [
  'per_second',
  'per_minute',
  'per_hour',
  'per_day',
  'regexp_extract',
  'sha256',
].sort();

const FUNCTIONS_WITH_SEPARATE_VALIDATION = ['cast'];

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: people }
spec:
  indexPatterns: ['people']
  template:
    mappings:
      properties:
        name: { type: keyword }
`, 'people.yaml');

describe('PPL function catalog', () => {
  it('covers every function on the OpenSearch collection documentation page', () => {
    expect([...ARRAY_FUNCTIONS].sort()).toEqual([
      'array', 'array_length', 'forall', 'exists', 'filter', 'transform', 'reduce',
      'mvjoin', 'mvappend', 'split', 'mvdedup', 'mvfind', 'mvindex', 'mvmap', 'mvzip',
    ].sort());
  });

  it.each([
    ['forall(array(1, 2, 3), element -> element > 0)', 'boolean'],
    ['exists(array(-1, 2), element -> element > 0)', 'boolean'],
    ['filter(array(-1, 2), element -> element > 0)', 'array'],
    ['transform(array(1, 2), element -> element + 2)', 'array'],
    ['transform(array(1, 2), (element, index) -> element + index)', 'array'],
    ['reduce(array(1, 2, 3), 0, (accumulator, element) -> accumulator + element)', 'int'],
    ['reduce(array(1, 2), 0, (accumulator, element) -> accumulator + element, accumulator -> accumulator * 10)', 'int'],
    ["reduce(array(1, 2), 0, (accumulator, element) -> accumulator + element, accumulator -> concat('total: ', cast(accumulator AS string)))", 'string'],
    ['mvmap(array(1, 2), 42)', 'array'],
    ['transform(array(), element -> element + 1)', 'array'],
    ['transform(array(array(1, 2)), row -> transform(row, element -> element + 1))', 'array'],
    ['transform(array(1, 2), outer -> transform(array(3), inner -> inner + outer))', 'array'],
    ['filter(array(1, 2), element -> element > length(name))', 'array'],
  ])('accepts higher-order collection expression %s', (expression, resultType) => {
    const query = `source=people | eval result = ${expression} | fields result`;
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates)).toEqual([]);
    expect(typedFieldScopeAt(query, templates, query.length)?.get('result')?.pplTypes).toEqual([resultType]);
  });

  it.each([
    'forall(array(1), true)',
    'exists(array(1), element -> element + 1)',
    'filter(array(1), (element, index) -> element > index)',
    'transform(array(1), (element, index, extra) -> element)',
    'reduce(array(1), 0, element -> element)',
    'reduce(array(1), 0, (accumulator, element) -> accumulator + element, (accumulator, extra) -> accumulator)',
    'transform(array(1), (element, element) -> element)',
    "reduce(array(1), 0, (accumulator, element) -> 'wrong type')",
    'mvmap(array(1))',
    'transform(array(true), element -> element + 1)',
  ])('rejects invalid higher-order collection expression %s', (expression) => {
    const query = `source=people | eval result = ${expression}`;
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);
    expect(diagnostics.some(({ code }) => code === 'PPL005')).toBe(false);
    expect(diagnostics.some(({ severity }) => severity === 'error')).toBe(true);
  });

  it('binds mvmap elements through a nested mvindex without changing the outer array field', () => {
    const query = 'source=people | eval numbers = array(1, 2, 3), multiplier = 10, result = mvmap(mvindex(numbers, 1, 2), numbers * multiplier) | eval size = array_length(numbers), first = mvindex(result, 0) | fields first, size';
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates)).toEqual([]);
    expect(typedFieldScopeAt(query, templates, query.length)?.get('first')?.pplTypes).toEqual(['int']);
  });

  it('keeps lambda parameters local and checks functions inside the body', () => {
    const linter = new PplLinter({ openSearchVersion: '3.5' });
    const outside = 'source=people | eval result = transform(array(1), element -> element + 1) | fields element';
    expect(linter.lint(outside, templates).some(({ code }) => code === 'PPL012')).toBe(true);
    const inside = 'source=people | eval result = transform(array(1), element -> nonexistent(element))';
    expect(linter.lint(inside, templates).some(({ code }) => code === 'PPL005')).toBe(true);
  });

  it('restores a shadowed outer field after checking a lambda', () => {
    const query = 'source=people | eval result = transform(array(1), name -> name + 1) | eval label = upper(name) | fields label';
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates)).toEqual([]);
  });

  it.each([
    ['mvappend(1, array(2, 3))', 'array'],
    ['mvappend(42)', 'array'],
    ["split('a;b;c', ';')", 'array'],
    ['mvdedup(array(1, 2, 2, 3))', 'array'],
    ["mvfind(array('apple', 'banana'), 'ban.*')", 'int'],
    ["mvindex(array('a', 'b', 'c'), -1)", 'string'],
    ['mvindex(array(1, 2, 3), -2, -1)', 'array'],
    ["mvzip(array('a'), array('b'))", 'array'],
    ["mvzip(array('a'), array('b'), ':')", 'array'],
  ])('accepts collection expression %s', (expression, resultType) => {
    const query = `source=people | eval result = ${expression} | fields result`;
    expect(new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates)).toEqual([]);
    expect(typedFieldScopeAt(query, templates, query.length)?.get('result')?.pplTypes)
      .toEqual(resultType ? [resultType] : []);
  });

  it.each([
    'mvappend()',
    "split('a')",
    "split(1, ',')",
    "mvdedup('a')",
    "mvfind(array('a'), true)",
    'mvindex(array(1))',
    'mvindex(array(1), false)',
    "mvzip(array('a'), 'b')",
    "mvzip(array('a'), array('b'), false)",
  ])('rejects invalid collection expression %s', (expression) => {
    const query = `source=people | eval result = ${expression}`;
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);
    expect(diagnostics.some(({ code }) => code === 'PPL005')).toBe(false);
    expect(diagnostics.some(({ severity }) => severity === 'error')).toBe(true);
  });

  it('recognizes mvjoin and infers a string result', () => {
    const query = "source=people | eval result = mvjoin(array('a', 'b', 'c'), ',') | eval upper_result = upper(result)";
    const linter = new PplLinter({ openSearchVersion: '3.5' });

    expect(linter.lint(query, templates)).toEqual([]);
    expect(typedFieldScopeAt(query, templates, query.length)?.get('result')?.pplTypes)
      .toEqual(['string']);
    expect(functionDocumentation('mvjoin')).toMatchObject({
      category: 'Array',
      syntax: ['mvjoin(array, delimiter)'],
      returnTypes: ['STRING'],
      hasSignature: true,
      docUrl: expect.stringContaining('/collection/'),
    });
  });

  it.each([
    "mvjoin(array('a'))",
    "mvjoin(array('a'), ',', 'extra')",
    "mvjoin('a', ',')",
    "mvjoin(array('a'), 1)",
  ])('rejects invalid mvjoin arguments: %s', (expression) => {
    const query = `source=people | eval result = ${expression}`;
    const diagnostics = new PplLinter({ openSearchVersion: '3.5' }).lint(query, templates);

    expect(diagnostics.some((diagnostic) => diagnostic.code === 'PPL005')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('keeps known functions and signatures in sync', () => {
    const knownFunctions = new Set(DEFAULT_KNOWN_FUNCTIONS);
    const signatureFunctions = new Set(FUNCTION_SIGNATURES.keys());
    const signatureFunctionsMissingFromCatalog = [...signatureFunctions]
      .filter((name) => !knownFunctions.has(name))
      .sort();
    const catalogFunctionsWithoutSignatures = [...knownFunctions]
      .filter(
        (name) =>
          !signatureFunctions.has(name) &&
          !FUNCTIONS_WITH_SEPARATE_VALIDATION.includes(name),
      )
      .sort();
    const unregisteredSpecialCases = FUNCTIONS_WITH_SEPARATE_VALIDATION.filter(
      (name) => !knownFunctions.has(name) || signatureFunctions.has(name),
    );

    expect(signatureFunctionsMissingFromCatalog).toEqual([]);
    expect(catalogFunctionsWithoutSignatures).toEqual(
      FUNCTIONS_WITHOUT_SIGNATURES,
    );
    expect(unregisteredSpecialCases).toEqual([]);
  });

  it('provides documentation for every known function and its valid completions', () => {
    const query = 'source=missing | where ';
    const candidates = completionCandidates(query, query.length, []).filter(
      (candidate) => candidate.kind === 'function',
    );
    const expected = DEFAULT_KNOWN_FUNCTIONS.filter(
      (name) =>
        !FUNCTION_SIGNATURES.has(name) || getFunctionSignature(name, 'where'),
    ).sort();

    expect(
      DEFAULT_KNOWN_FUNCTIONS.every(
        (name) => functionDocumentation(name)?.syntax.length,
      ),
    ).toBe(true);
    expect(candidates.map((candidate) => candidate.label).sort()).toEqual(
      expected,
    );
    expect(
      candidates.every((candidate) => candidate.documentation?.length),
    ).toBe(true);
  });
});
