import { describe, expect, it } from 'vitest';
import { completionCandidates } from '../../src/core/completion';
import { functionDocumentation } from '../../src/core/catalog/functionDocumentation';
import { DEFAULT_KNOWN_FUNCTIONS } from '../../src/core/catalog/functions';
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
  'typeof',
].sort();

const FUNCTIONS_WITH_SEPARATE_VALIDATION = ['cast'];

describe('PPL function catalog', () => {
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
