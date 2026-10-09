import { describe, expect, it } from 'vitest';
import {
  functionDocumentation,
  functionInfoAt,
  renderFunctionDocumentation,
} from '../../src/core/catalog/functionDocumentation';
import { extractQueries } from '../../src/extractors/extractor';
import { offsetToPosition } from '../../src/extractors/sourcemap';

describe('PPL function documentation', () => {
  it('documents named relevance options and links to the researched version', () => {
    const documentation = functionDocumentation('match')!;
    expect(documentation.options).toContainEqual({ name: 'lenient', type: 'boolean' });
    expect(documentation.options).toContainEqual({ name: 'boost', type: 'number' });
    expect(renderFunctionDocumentation(documentation)).toContain('`operator`: string');
    expect(documentation.docUrl).toBe('https://docs.opensearch.org/3.5/sql-and-ppl/ppl/functions/relevance/#match');
  });

  it('resolves signature, syntax, result, context, and docs link at an incomplete call', () => {
    const query = 'source=events | eval next = date_add(now(), INTERVAL 1 DAY)';
    const start = query.indexOf('date_add');
    const info = functionInfoAt(query, start + 2);

    expect(info?.span).toEqual({ start, end: start + 'date_add'.length });
    expect(info?.documentation).toMatchObject({
      name: 'date_add',
      syntax: ['date_add(date, INTERVAL amount unit)'],
      returnTypes: ['TIMESTAMP'],
      hasSignature: true,
    });
    expect(info?.documentation.docUrl).toContain('/datetime/');
    expect(renderFunctionDocumentation(info!.documentation)).toContain(
      'INTERVAL amount unit',
    );
  });

  it('keeps unsigned catalog functions explicit in hover documentation', () => {
    const documentation = functionDocumentation('sha256');

    expect(documentation).toMatchObject({
      category: 'Cryptographic',
      hasSignature: false,
      syntax: ['sha256(...)'],
    });
    expect(renderFunctionDocumentation(documentation!)).toContain(
      'validation are not implemented',
    );
  });

  it('does not resolve function-shaped text inside a string or a field reference', () => {
    const stringQuery = "source=events | where message == 'right('";
    const fieldQuery = 'source=events | where right > 0';

    expect(
      functionInfoAt(stringQuery, stringQuery.indexOf('right')),
    ).toBeUndefined();
    expect(
      functionInfoAt(fieldQuery, fieldQuery.indexOf('right')),
    ).toBeUndefined();
  });

  it('maps function documentation spans from extracted YAML queries to the host', () => {
    const yaml =
      'rule:\n  query: |\n    source=events | eval suffix = right(message, 3)\n';
    const [query] = extractQueries(yaml, 'yaml', ['rule.query'], false);
    const start = query.rawText.indexOf('right');
    const info = functionInfoAt(query.rawText, start + 1)!;
    const range = query.sourceMap.translate({
      start: {
        ...offsetToPosition(query.rawText, info.span.start),
        offset: info.span.start,
      },
      end: {
        ...offsetToPosition(query.rawText, info.span.end),
        offset: info.span.end,
      },
    });
    const hostColumn = yaml.split(/\r?\n/)[2].indexOf('right');

    expect(range?.start).toEqual({ line: 2, col: hostColumn });
    expect(range?.end).toEqual({ line: 2, col: hostColumn + 'right'.length });
  });
});
