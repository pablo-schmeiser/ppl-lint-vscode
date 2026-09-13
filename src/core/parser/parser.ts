import {
  ErrorNode,
  ExpressionNode,
  FieldsStageNode,
  FunctionCallNode,
  GenericStageNode,
  IdentifierNode,
  LiteralNode,
  PipelineNode,
  PipeStageNode,
  RenameStageNode,
  SortStageNode,
  SourceStageNode,
  Span,
  StatsStageNode,
  Token,
  TokenType,
  WhereStageNode,
} from '../../types';
import {
  createBinaryExpressionNode,
  createErrorNode,
  createFieldsStageNode,
  createFunctionCallNode,
  createGenericStageNode,
  createIdentifierNode,
  createLiteralNode,
  createPipelineNode,
  createRenameStageNode,
  createSortStageNode,
  createSourceStageNode,
  createStatsStageNode,
  createUnaryExpressionNode,
  createWhereStageNode,
} from '../ast/nodes';
import { tokenize } from '../lexer/tokenizer';

export class PplParser {
  private tokens: Token[] = [];
  private current = 0;
  private syntaxErrors: ErrorNode[] = [];

  constructor(input: string | Token[]) {
    if (typeof input === 'string') {
      this.tokens = tokenize(input);
    } else {
      this.tokens = input;
    }
  }

  public parse(): PipelineNode {
    this.current = 0;
    this.syntaxErrors = [];

    // Collect lexer-level syntax errors (e.g. unclosed string literals or backticks)
    this.collectLexerErrors();

    const startPos = this.peek().span.start;

    // Parse initial stage (source or search)
    const sourceNode = this.parseSourceStage();

    const stages: PipeStageNode[] = [];

    while (!this.isAtEnd()) {
      if (this.match(TokenType.PIPE)) {
        const pipeToken = this.previous();
        if (this.checkTrailingPipe(pipeToken)) {
          continue;
        }

        try {
          const stage = this.parsePipeStage();
          if (stage) {
            stages.push(stage);
          }
        } catch (e: any) {
          this.recordErrorAndSynchronize(
            e?.message || 'Error parsing stage',
            this.peek().span
          );
        }
      } else {
        // Stray token outside pipe
        const token = this.advance();
        if (token.type !== TokenType.EOF) {
          this.recordErrorAndSynchronize(
            `Unexpected token '${token.value}'. Expected '|' to chain commands.`,
            token.span
          );
        }
      }
    }

    const endPos = this.previous().span.end;
    const overallSpan: Span = {
      start: startPos,
      end: endPos,
    };

    return createPipelineNode(sourceNode, stages, this.syntaxErrors, overallSpan);
  }

  private collectLexerErrors(): void {
    for (const token of this.tokens) {
      if (token.unclosed) {
        const message =
          token.type === TokenType.STRING_LITERAL
            ? 'Unclosed string literal: missing closing quote'
            : 'Unclosed identifier: missing closing backtick';
        this.recordError(message, token.span);
      }
    }
  }

  private checkTrailingPipe(pipeToken: Token): boolean {
    if (this.isAtEnd() || this.peek().type === TokenType.PIPE) {
      this.recordError(
        'Trailing pipe or empty stage',
        pipeToken.span,
        'command',
        this.peek().type === TokenType.EOF ? 'EOF' : this.peek().value
      );
      return true;
    }
    return false;
  }

  // ==========================================
  // Source Stage Parsing
  // ==========================================

  private parseSourceStage(): SourceStageNode | ErrorNode {
    const startToken = this.peek();

    // Check if starts with `source`
    if (this.check(TokenType.SOURCE)) {
      this.advance(); // consume source
      if (!this.match(TokenType.ASSIGN)) {
        return this.recordErrorAndSynchronize(
          "Expected '=' after 'source'",
          this.peek().span,
          '='
        );
      }

      const indexToken = this.peek();
      if (
        indexToken.type === TokenType.IDENTIFIER ||
        indexToken.type === TokenType.STRING_LITERAL
      ) {
        this.advance();
        const span: Span = {
          start: startToken.span.start,
          end: indexToken.span.end,
        };
        return createSourceStageNode(indexToken.value, false, span);
      } else {
        return this.recordErrorAndSynchronize(
          'Expected index identifier after source=',
          indexToken.span
        );
      }
    }

    // Check if starts with `search`
    if (this.check(TokenType.SEARCH)) {
      this.advance(); // consume search
      if (this.check(TokenType.SOURCE)) {
        this.advance(); // consume source
        if (!this.match(TokenType.ASSIGN)) {
          return this.recordErrorAndSynchronize(
            "Expected '=' after 'search source'",
            this.peek().span,
            '='
          );
        }
      } else if (this.check(TokenType.ASSIGN)) {
        this.advance(); // consume =
      }

      const indexToken = this.peek();
      if (
        indexToken.type === TokenType.IDENTIFIER ||
        indexToken.type === TokenType.STRING_LITERAL
      ) {
        this.advance();
        const span: Span = {
          start: startToken.span.start,
          end: indexToken.span.end,
        };
        return createSourceStageNode(indexToken.value, true, span);
      } else {
        return this.recordErrorAndSynchronize(
          'Expected index name after search',
          indexToken.span
        );
      }
    }

    // Missing source command
    const err = this.recordError(
      'Missing source command: PPL query must begin with source=<index> or search [source=]<index>',
      startToken.span
    );

    // If startToken is a pipe command (e.g. `where`), do not consume it; let subsequent loop parse it
    if (
      startToken.type === TokenType.WHERE ||
      startToken.type === TokenType.STATS ||
      startToken.type === TokenType.FIELDS ||
      startToken.type === TokenType.SORT ||
      startToken.type === TokenType.RENAME ||
      startToken.type === TokenType.EVAL
    ) {
      // Don't consume; let caller handle as stage
    }

    return err;
  }

  // ==========================================
  // Pipe Stage Parsing
  // ==========================================

  private parsePipeStage(): PipeStageNode | null {
    const cmdToken = this.peek();
    const cmdName = cmdToken.value.toLowerCase();

    if (cmdToken.type === TokenType.WHERE || cmdName === 'where') {
      return this.parseWhereStage();
    }

    if (cmdToken.type === TokenType.STATS || cmdName === 'stats') {
      return this.parseStatsStage();
    }

    if (cmdToken.type === TokenType.FIELDS || cmdName === 'fields') {
      return this.parseFieldsStage();
    }

    if (cmdToken.type === TokenType.SORT || cmdName === 'sort') {
      return this.parseSortStage();
    }

    if (cmdToken.type === TokenType.RENAME || cmdName === 'rename') {
      return this.parseRenameStage();
    }

    // Generic stage for other commands (eval, dedup, head, top, rare, grok, etc.)
    return this.parseGenericStage();
  }

  private parseWhereStage(): WhereStageNode {
    const startToken = this.advance(); // consume 'where'
    if (this.check(TokenType.PIPE) || this.isAtEnd()) {
      const err = this.recordError(
        "Expected condition after 'where'",
        startToken.span
      );
      return createWhereStageNode(err, startToken.span);
    }
    const condition = this.parseExpression();

    const endPos = this.previous().span.end;
    const span: Span = {
      start: startToken.span.start,
      end: endPos,
    };

    return createWhereStageNode(condition, span);
  }

  private parseStatsStage(): StatsStageNode {
    const startToken = this.advance(); // consume 'stats'
    const aggregations = this.parseStatsAggregations();
    let groupBy: IdentifierNode[] = [];

    // Optional: 'by' <field-list>
    if (this.match(TokenType.BY)) {
      groupBy = this.parseCommaSeparatedFields(
        "Expected field identifier in stats 'by' clause"
      );
    }

    const endPos = this.previous().span.end;
    const span: Span = {
      start: startToken.span.start,
      end: endPos,
    };

    return createStatsStageNode(aggregations, groupBy, span);
  }

  private parseStatsAggregations(): FunctionCallNode[] {
    const aggregations: FunctionCallNode[] = [];
    // Parse aggregation function list until 'by' or next pipe/EOF
    while (!this.isAtEnd() && !this.check(TokenType.PIPE) && !this.check(TokenType.BY)) {
      const expr = this.parsePrimary();
      if (expr.type === 'FunctionCall') {
        aggregations.push(expr as FunctionCallNode);
      } else {
        this.recordError(
          "Expected aggregation function (e.g. 'count()', 'avg(field)') in stats command",
          expr.span
        );
      }

      if (!this.match(TokenType.COMMA)) {
        break;
      }
    }
    return aggregations;
  }

  private parseFieldsStage(): FieldsStageNode {
    const startToken = this.advance(); // consume 'fields'
    let mode: '+' | '-' | undefined = undefined;

    if (this.match(TokenType.PLUS)) {
      mode = '+';
    } else if (this.match(TokenType.MINUS)) {
      mode = '-';
    }

    const fields = this.parseCommaSeparatedFields(
      'Expected field name in fields command'
    );

    const endPos = this.previous().span.end;
    const span: Span = {
      start: startToken.span.start,
      end: endPos,
    };

    return createFieldsStageNode(fields, mode, span);
  }

  private parseSortStage(): SortStageNode {
    const startToken = this.advance(); // consume 'sort'
    let direction: '+' | '-' | undefined = undefined;

    if (this.match(TokenType.PLUS)) {
      direction = '+';
    } else if (this.match(TokenType.MINUS)) {
      direction = '-';
    }

    const fields = this.parseCommaSeparatedFields(
      'Expected field name in sort command'
    );

    const endPos = this.previous().span.end;
    const span: Span = {
      start: startToken.span.start,
      end: endPos,
    };

    return createSortStageNode(fields, direction, span);
  }

  private parseCommaSeparatedFields(
    errorMessagePrefix: string,
    allowWildcard: boolean = true
  ): IdentifierNode[] {
    const fields: IdentifierNode[] = [];

    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      const fieldToken = this.peek();

      if (this.isFieldIdentifierToken(fieldToken, allowWildcard)) {
        this.advance();
        fields.push(
          createIdentifierNode(
            fieldToken.value,
            this.isBacktickQuoted(fieldToken),
            fieldToken.span
          )
        );
      } else {
        this.recordError(
          `${errorMessagePrefix}, got '${fieldToken.value}'`,
          fieldToken.span
        );
        break;
      }

      if (!this.match(TokenType.COMMA)) {
        break;
      }
    }

    return fields;
  }

  private parseRenameStage(): RenameStageNode {
    const startToken = this.advance(); // consume 'rename'
    const pairs: Array<{ from: IdentifierNode; to: IdentifierNode }> = [];

    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      const fromToken = this.peek();
      const fromNode = this.parseFieldIdentifier(
        `Expected source field name in rename command, got '${fromToken.value}'`
      );
      if (!fromNode) {
        break;
      }

      if (!this.match(TokenType.AS)) {
        this.recordError(
          `Expected 'as' in rename command (e.g. 'rename old as new')`,
          this.peek().span
        );
        break;
      }

      const toNode = this.parseFieldIdentifier(
        `Expected target field name after 'as' in rename command`
      );
      if (!toNode) {
        break;
      }

      pairs.push({ from: fromNode, to: toNode });

      if (!this.match(TokenType.COMMA)) {
        break;
      }
    }

    const endPos = this.previous().span.end;
    const span: Span = {
      start: startToken.span.start,
      end: endPos,
    };

    return createRenameStageNode(pairs, span);
  }

  private parseFieldIdentifier(errorMessage: string): IdentifierNode | null {
    const token = this.peek();
    if (!this.isFieldIdentifierToken(token, false)) {
      this.recordError(errorMessage, token.span);
      return null;
    }
    this.advance();
    return createIdentifierNode(
      token.value,
      this.isBacktickQuoted(token),
      token.span
    );
  }

  private parseGenericStage(): GenericStageNode {
    const cmdToken = this.advance();
    const cmdName = cmdToken.value;
    const rawTokens: string[] = [];

    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      rawTokens.push(this.advance().value);
    }

    const endPos = this.previous().span.end;
    const span: Span = {
      start: cmdToken.span.start,
      end: endPos,
    };

    return createGenericStageNode(cmdName, rawTokens.join(' '), span);
  }

  // ==========================================
  // Expression Parsing (Precedence Climbing)
  // ==========================================

  public parseExpression(): ExpressionNode {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): ExpressionNode {
    let expr = this.parseLogicalAnd();

    while (this.match(TokenType.OR)) {
      const op = this.previous();
      const right = this.parseLogicalAnd();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseLogicalAnd(): ExpressionNode {
    let expr = this.parseEquality();

    while (this.match(TokenType.AND)) {
      const op = this.previous();
      const right = this.parseEquality();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseEquality(): ExpressionNode {
    let expr = this.parseComparison();

    while (
      this.match(TokenType.EQUALS) ||
      this.match(TokenType.NOT_EQUALS) ||
      this.match(TokenType.ASSIGN) || // captured for PPL007 check
      this.match(TokenType.LIKE) ||
      this.match(TokenType.IN)
    ) {
      const op = this.previous();
      const right = this.parseComparison();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseComparison(): ExpressionNode {
    let expr = this.parseAdditive();

    while (
      this.match(TokenType.GT) ||
      this.match(TokenType.GTE) ||
      this.match(TokenType.LT) ||
      this.match(TokenType.LTE)
    ) {
      const op = this.previous();
      const right = this.parseAdditive();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseAdditive(): ExpressionNode {
    let expr = this.parseMultiplicative();

    while (this.match(TokenType.PLUS) || this.match(TokenType.MINUS)) {
      const op = this.previous();
      const right = this.parseMultiplicative();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseMultiplicative(): ExpressionNode {
    let expr = this.parseUnary();

    while (
      this.match(TokenType.STAR) ||
      this.match(TokenType.SLASH) ||
      this.match(TokenType.PERCENT)
    ) {
      const op = this.previous();
      const right = this.parseUnary();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseUnary(): ExpressionNode {
    if (this.match(TokenType.NOT) || this.match(TokenType.MINUS) || this.match(TokenType.PLUS)) {
      const op = this.previous();
      const right = this.parseUnary();
      const span: Span = { start: op.span.start, end: right.span.end };
      return createUnaryExpressionNode(op.value, right, span);
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    return (
      this.parseParenthesizedExpression() ??
      this.parseLiteral() ??
      this.parseFunctionCallOrIdentifier() ??
      this.parsePrimaryFallbackError()
    );
  }

  private parsePrimaryFallbackError(): ErrorNode {
    if (this.check(TokenType.PIPE) || this.isAtEnd()) {
      const found = this.isAtEnd() ? 'EOF' : `'${this.peek().value}'`;
      return this.recordError(`Expected expression, found ${found}`, this.peek().span);
    }

    const token = this.advance();
    return this.recordError(
      `Unexpected token '${token.value}' in expression`,
      token.span
    );
  }

  private parseParenthesizedExpression(): ExpressionNode | null {
    // Parenthesized expression: (expr)
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression();
      if (!this.match(TokenType.RPAREN)) {
        this.recordError(
          "Unclosed parenthesis: expected ')'",
          this.peek().span,
          ')'
        );
        return expr;
      }
      return expr;
    }
    return null;
  }

  private parseLiteral(): LiteralNode | null {
    // Literals
    if (this.match(TokenType.NUMBER_LITERAL)) {
      const token = this.previous();
      const num = Number(token.value);
      return createLiteralNode(num, token.value, token.span);
    }

    if (this.match(TokenType.STRING_LITERAL)) {
      const token = this.previous();
      return createLiteralNode(token.value, token.value, token.span);
    }

    if (this.match(TokenType.BOOLEAN_LITERAL)) {
      const token = this.previous();
      const boolVal = token.value.toLowerCase() === 'true';
      return createLiteralNode(boolVal, token.value, token.span);
    }

    if (this.match(TokenType.NULL_LITERAL)) {
      const token = this.previous();
      return createLiteralNode(null, token.value, token.span);
    }

    return null;
  }

  private parseFunctionCallOrIdentifier(): ExpressionNode | null {
    // Function call or Identifier or Keyword acting as identifier
    if (this.isFieldIdentifierToken(this.peek(), true)) {
      const token = this.advance();

      // Check if next token is '(' -> Function call
      if (this.match(TokenType.LPAREN)) {
        return this.parseFunctionCall(token);
      }

      // Normal identifier
      return createIdentifierNode(
        token.value,
        this.isBacktickQuoted(token),
        token.span
      );
    }

    return null;
  }

  private parseFunctionCall(calleeToken: Token): ExpressionNode {
    const args = this.parseFunctionArguments();

    if (!this.match(TokenType.RPAREN)) {
      return this.recordError(
        `Unclosed function call '${calleeToken.value}': expected ')'`,
        this.peek().span,
        ')'
      );
    }

    const endPos = this.previous().span.end;
    const span: Span = { start: calleeToken.span.start, end: endPos };
    return createFunctionCallNode(calleeToken.value, args, span);
  }

  private parseFunctionArguments(): ExpressionNode[] {
    const args: ExpressionNode[] = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        if (this.match(TokenType.STAR)) {
          // e.g. count(*)
          const starTok = this.previous();
          args.push(createIdentifierNode('*', false, starTok.span));
        } else {
          args.push(this.parseExpression());
        }
      } while (this.match(TokenType.COMMA));
    }
    return args;
  }

  // ==========================================
  // Helper & Recovery Methods
  // ==========================================

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current] || {
      type: TokenType.EOF,
      value: '',
      span: {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: 0, col: 0, offset: 0 },
      },
    };
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private isBacktickQuoted(token: Token): boolean {
    return (
      token.value.startsWith('`') ||
      token.span.end.offset - token.span.start.offset > token.value.length
    );
  }

  private isFieldIdentifierToken(token: Token, allowWildcard: boolean = false): boolean {
    if (token.type === TokenType.IDENTIFIER) return true;
    if (allowWildcard && token.type === TokenType.STAR) return true;
    return (
      token.type === TokenType.SOURCE ||
      token.type === TokenType.SEARCH ||
      token.type === TokenType.ISNULL ||
      token.type === TokenType.ISNOTNULL
    );
  }

  private synchronizeToNextPipe(): void {
    while (!this.isAtEnd()) {
      if (this.peek().type === TokenType.PIPE) {
        return;
      }
      this.advance();
    }
  }

  private recordError(
    message: string,
    span: Span,
    expectedToken?: string,
    foundToken?: string
  ): ErrorNode {
    const err = createErrorNode(message, span, expectedToken, foundToken);
    this.syntaxErrors.push(err);
    return err;
  }

  private recordErrorAndSynchronize(
    message: string,
    span: Span,
    expectedToken?: string,
    foundToken?: string
  ): ErrorNode {
    const err = this.recordError(message, span, expectedToken, foundToken);
    this.synchronizeToNextPipe();
    return err;
  }
}

export function parsePpl(input: string | Token[]): PipelineNode {
  return new PplParser(input).parse();
}
