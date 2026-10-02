import { describe, expect, it } from 'vitest';
import { COMMAND_DOCS } from '../../src/core/catalog/commands';

describe('PPL command documentation', () => {
  it('provides lookup metadata for command hover previews', () => {
    expect(COMMAND_DOCS.lookup).toMatchObject({
      name: 'lookup',
      syntax: expect.stringContaining('<lookupIndex>'),
      example: expect.stringContaining('| lookup '),
      docUrl: 'https://docs.opensearch.org/latest/sql-and-ppl/ppl/commands/lookup/',
    });
  });
});
