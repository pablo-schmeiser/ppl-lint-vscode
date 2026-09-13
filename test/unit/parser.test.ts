import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/core/lexer/tokenizer';
import { parsePpl } from '../../src/core/parser/parser';
import { TokenType } from '../../src/types';

describe('PPL Tokenizer', () => {
  it('tokenizes simple source and pipe commands with exact spans', () => {
    const query = 'source=accounts | where age > 30';
    const tokens = tokenize(query);

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0]).toMatchObject({
      type: TokenType.SOURCE,
      value: 'source',
      span: {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: 0, col: 6, offset: 6 },
      },
    });

    expect(tokens[1]).toMatchObject({
      type: TokenType.ASSIGN,
      value: '=',
      span: {
        start: { line: 0, col: 6, offset: 6 },
        end: { line: 0, col: 7, offset: 7 },
      },
    });

    expect(tokens[2]).toMatchObject({
      type: TokenType.IDENTIFIER,
      value: 'accounts',
      span: {
        start: { line: 0, col: 7, offset: 7 },
        end: { line: 0, col: 15, offset: 15 },
      },
    });

    const pipeToken = tokens.find((t) => t.type === TokenType.PIPE);
    expect(pipeToken).toBeDefined();
    expect(pipeToken?.span.start.col).toBe(16);
  });

  it('handles line comments and block comments', () => {
    const query = `// Comment line
source=logs /* block comment */ | where status == 200`;
    const tokens = tokenize(query);

    expect(tokens[0].type).toBe(TokenType.SOURCE);
    expect(tokens[0].span.start.line).toBe(1);
    expect(tokens.some((t) => t.type === TokenType.WHERE)).toBe(true);
  });

  it('tokenizes string literals with escape sequences', () => {
    const query = `source=logs | where message = "hello \\"world\\""`;
    const tokens = tokenize(query);
    const strToken = tokens.find((t) => t.type === TokenType.STRING_LITERAL);
    expect(strToken).toBeDefined();
    expect(strToken?.value).toBe('hello "world"');
  });

  it('tokenizes backtick-quoted identifiers', () => {
    const query = 'source=logs | where `user.id` == 123';
    const tokens = tokenize(query);
    const backtickToken = tokens.find((t) => t.value === 'user.id');
    expect(backtickToken).toBeDefined();
    expect(backtickToken?.type).toBe(TokenType.IDENTIFIER);
  });

  it('tokenizes unclosed string literals with unclosed flag and stops at newline', () => {
    const query = `source=logs | where msg = "unclosed
| stats count()`;
    const tokens = tokenize(query);
    const unclosedStr = tokens.find((t) => t.type === TokenType.STRING_LITERAL);
    expect(unclosedStr).toBeDefined();
    expect(unclosedStr?.value).toBe('unclosed');
    expect(unclosedStr?.unclosed).toBe(true);

    // Verify stats stage on next line was not swallowed
    expect(tokens.some((t) => t.type === TokenType.STATS)).toBe(true);
  });

  it('tokenizes unclosed backtick identifiers with unclosed flag', () => {
    const query = 'source=logs | where `unclosed_field == 1';
    const tokens = tokenize(query);
    const unclosedIdent = tokens.find((t) => t.value === 'unclosed_field == 1');
    expect(unclosedIdent).toBeDefined();
    expect(unclosedIdent?.type).toBe(TokenType.IDENTIFIER);
    expect(unclosedIdent?.unclosed).toBe(true);
  });
});

describe('PPL Parser', () => {
  it('parses valid multi-stage pipeline: source, where, stats', () => {
    const query = 'source=accounts | where age > 30 | stats count() by state';
    const ast = parsePpl(query);

    expect(ast.type).toBe('Pipeline');
    expect(ast.syntaxErrors).toHaveLength(0);
    expect(ast.source.type).toBe('SourceStage');
    if (ast.source.type === 'SourceStage') {
      expect(ast.source.indexName).toBe('accounts');
    }

    expect(ast.stages).toHaveLength(2);
    expect(ast.stages[0].type).toBe('WhereStage');
    expect(ast.stages[1].type).toBe('StatsStage');

    const statsStage = ast.stages[1] as any;
    expect(statsStage.aggregations).toHaveLength(1);
    expect(statsStage.aggregations[0].functionName).toBe('count');
    expect(statsStage.groupBy).toHaveLength(1);
    expect(statsStage.groupBy[0].name).toBe('state');
  });

  it('parses search source prefix and fields/sort stages', () => {
    const query = 'search source=logs | fields + host, status | sort - bytes';
    const ast = parsePpl(query);

    expect(ast.syntaxErrors).toHaveLength(0);
    expect(ast.source.type).toBe('SourceStage');
    if (ast.source.type === 'SourceStage') {
      expect(ast.source.isSearchPrefix).toBe(true);
      expect(ast.source.indexName).toBe('logs');
    }

    expect(ast.stages).toHaveLength(2);
    expect(ast.stages[0].type).toBe('FieldsStage');
    expect((ast.stages[0] as any).mode).toBe('+');
    expect((ast.stages[0] as any).fields).toHaveLength(2);

    expect(ast.stages[1].type).toBe('SortStage');
    expect((ast.stages[1] as any).direction).toBe('-');
  });

  it('parses complex nested boolean expressions in where stage', () => {
    const query = `source=logs | where (status >= 400 AND status < 500) OR host = 'prod'`;
    const ast = parsePpl(query);

    expect(ast.syntaxErrors).toHaveLength(0);
    expect(ast.stages[0].type).toBe('WhereStage');
    const whereStage = ast.stages[0] as any;
    expect(whereStage.condition.type).toBe('BinaryExpression');
    expect(whereStage.condition.operator.toUpperCase()).toBe('OR');
  });

  it('parses rename command stage', () => {
    const query = 'source=logs | rename old_field as new_field, user as account';
    const ast = parsePpl(query);

    expect(ast.syntaxErrors).toHaveLength(0);
    expect(ast.stages[0].type).toBe('RenameStage');
    const renameStage = ast.stages[0] as any;
    expect(renameStage.pairs).toHaveLength(2);
    expect(renameStage.pairs[0].from.name).toBe('old_field');
    expect(renameStage.pairs[0].to.name).toBe('new_field');
  });

  describe('Error Recovery', () => {
    it('recovers from malformed stage and parses subsequent valid stages', () => {
      const query = 'source=logs | where | stats count()';
      const ast = parsePpl(query);

      // Syntax error captured on empty where stage
      expect(ast.syntaxErrors.length).toBeGreaterThan(0);
      // Stats stage still parsed successfully due to pipe resynchronization
      expect(ast.stages.some((s) => s.type === 'StatsStage')).toBe(true);
    });

    it('reports missing source command when starting directly with where', () => {
      const query = 'where status = 200';
      const ast = parsePpl(query);

      expect(ast.source.type).toBe('ErrorNode');
      expect(ast.syntaxErrors.some((e) => e.message.includes('Missing source'))).toBe(true);
    });

    it('handles trailing pipe gracefully without crashing', () => {
      const query = 'source=logs |';
      const ast = parsePpl(query);

      expect(ast.syntaxErrors.some((e) => e.message.includes('Trailing pipe'))).toBe(true);
    });

    it('captures unclosed string literal and unclosed parenthesis', () => {
      const query = "source=logs | where name = 'unclosed";
      const ast = parsePpl(query);
      expect(ast.type).toBe('Pipeline');
      expect(ast.syntaxErrors.some((e) => e.message.includes('Unclosed string literal'))).toBe(true);

      const queryParen = 'source=logs | where (status == 200';
      const astParen = parsePpl(queryParen);
      expect(astParen.syntaxErrors.some((e) => e.message.includes('parenthesis'))).toBe(true);
    });

    it('captures unclosed backtick identifier at end of input', () => {
      const query = 'source=logs | where `unclosed';
      const ast = parsePpl(query);
      expect(ast.type).toBe('Pipeline');
      expect(ast.syntaxErrors.some((e) => e.message.includes('Unclosed identifier'))).toBe(true);
    });

    it('captures unclosed backtick identifier and preserves pipeline stages', () => {
      const query = `source=logs
| where \`unclosed == 1
| stats count()`;
      const ast = parsePpl(query);
      expect(ast.type).toBe('Pipeline');
      expect(ast.syntaxErrors.some((e) => e.message.includes('Unclosed identifier'))).toBe(true);
      expect(ast.stages.some((s) => s.type === 'StatsStage')).toBe(true);
    });

    it('recovers from unclosed string on line 1 and parses line 2 stage', () => {
      const query = `source=logs
| where status = "unclosed
| stats count() by host`;
      const ast = parsePpl(query);
      expect(ast.type).toBe('Pipeline');
      expect(ast.syntaxErrors.some((e) => e.message.includes('Unclosed string literal'))).toBe(true);
      expect(ast.stages.some((s) => s.type === 'StatsStage')).toBe(true);
    });

    it('captures errors for invalid field names in rename stage', () => {
      const query1 = 'source=logs | rename 123 as new_field';
      const ast1 = parsePpl(query1);
      expect(ast1.syntaxErrors.some((e) => e.message.includes('Expected source field name in rename command'))).toBe(true);

      const query2 = 'source=logs | rename old_field as 456';
      const ast2 = parsePpl(query2);
      expect(ast2.syntaxErrors.some((e) => e.message.includes("Expected target field name after 'as'"))).toBe(true);
    });

    it('parses boolean, null, and number literals accurately', () => {
      const query = 'source=logs | where is_active = true AND count = null AND score = 42';
      const ast = parsePpl(query);
      expect(ast.syntaxErrors).toHaveLength(0);
      expect(ast.stages[0].type).toBe('WhereStage');
    });

    it('handles consecutive pipes with empty stage error recovery', () => {
      const query = 'source=logs || where status = 200';
      const ast = parsePpl(query);
      expect(ast.syntaxErrors.some((e) => e.message.includes('Trailing pipe or empty stage'))).toBe(true);
      expect(ast.stages.some((s) => s.type === 'WhereStage')).toBe(true);
    });

    it('parses comma-separated fields with keywords in fields stage and reports invalid tokens', () => {
      const validQuery = 'source=logs | fields + host, search, source, *';
      const validAst = parsePpl(validQuery);
      expect(validAst.syntaxErrors).toHaveLength(0);
      const fieldsStage = validAst.stages[0] as any;
      expect(fieldsStage.fields).toHaveLength(4);

      const invalidQuery = 'source=logs | fields 123';
      const invalidAst = parsePpl(invalidQuery);
      expect(invalidAst.syntaxErrors.some((e) => e.message.includes('Expected field name in fields command'))).toBe(true);
    });

    it('parses sort fields and reports errors on invalid tokens', () => {
      const query = 'source=logs | sort - bytes, host';
      const ast = parsePpl(query);
      expect(ast.syntaxErrors).toHaveLength(0);
      const sortStage = ast.stages[0] as any;
      expect(sortStage.fields).toHaveLength(2);

      const invalidSort = 'source=logs | sort 123';
      const invalidAst = parsePpl(invalidSort);
      expect(invalidAst.syntaxErrors.some((e) => e.message.includes('Expected field name in sort command'))).toBe(true);
    });

    it('parses multi-argument function calls and reports unclosed function calls', () => {
      const query = 'source=logs | where concat(first_name, " ", last_name) == "John Doe"';
      const ast = parsePpl(query);
      expect(ast.syntaxErrors).toHaveLength(0);

      const unclosedQuery = 'source=logs | where concat(first_name, last_name';
      const unclosedAst = parsePpl(unclosedQuery);
      expect(unclosedAst.syntaxErrors.some((e) => e.message.includes("Unclosed function call 'concat'"))).toBe(true);
    });

    it('correctly sets isBacktickQuoted on identifier nodes', () => {
      const query = 'source=logs | where `user.id` == plain_field';
      const ast = parsePpl(query);
      expect(ast.syntaxErrors).toHaveLength(0);
      const whereStage = ast.stages[0] as any;
      expect(whereStage.condition.left.isBacktickQuoted).toBe(true);
      expect(whereStage.condition.left.name).toBe('user.id');
      expect(whereStage.condition.right.isBacktickQuoted).toBe(false);
      expect(whereStage.condition.right.name).toBe('plain_field');
    });

    it('allows keywords like source and search to act as identifiers in sort, stats by, and rename', () => {
      const query = 'source=logs | sort - source | stats count() by search | rename source as origin';
      const ast = parsePpl(query);
      expect(ast.syntaxErrors).toHaveLength(0);
      expect(ast.stages).toHaveLength(3);
      expect(ast.stages[0].type).toBe('SortStage');
      expect(ast.stages[1].type).toBe('StatsStage');
      expect(ast.stages[2].type).toBe('RenameStage');
    });
  });
});

