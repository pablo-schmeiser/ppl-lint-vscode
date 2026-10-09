import {
  DedupStageNode,
  ErrorNode,
  EvalStageNode,
  ExpressionNode,
  FieldsStageNode,
  FunctionCallNode,
  GenericStageNode,
  HeadStageNode,
  IdentifierNode,
  InExpressionNode,
  JoinStageNode,
  LiteralNode,
  NamedArgumentNode,
  RelevanceFieldListNode,
  LookupStageNode,
  OptionStageNode,
  PipelineNode,
  PipeStageNode,
  PatternStageNode,
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
  createCastExpressionNode,
  createDedupStageNode,
  createEvalStageNode,
  createErrorNode,
  createFieldsStageNode,
  createFunctionCallNode,
  createGenericStageNode,
  createHeadStageNode,
  createIdentifierNode,
  createLiteralNode,
  createLambdaExpressionNode,
  createPipelineNode,
  createRenameStageNode,
  createSortStageNode,
  createSourceStageNode,
  createStatsStageNode,
  createUnaryExpressionNode,
  createWhereStageNode,
} from '../ast/nodes';
import { tokenize } from '../lexer/tokenizer';
import { getFunctionSignature } from '../catalog/functionSignatures';

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

    if (sourceNode.type === 'ErrorNode' && !this.isAtEnd() && !this.check(TokenType.PIPE)) {
      stages.push(this.parsePipeStage()!);
    }

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

    return err;
  }

  // ==========================================
  // Pipe Stage Parsing
  // ==========================================

  private parsePipeStage(): PipeStageNode | null {
    const cmdToken = this.peek();
    const cmdName = cmdToken.value.toLowerCase();

    if (cmdName === 'join' ||
        (['inner', 'left', 'right', 'full', 'cross'].includes(cmdName) &&
         ['join', 'semi', 'anti'].includes(this.tokens[this.current + 1]?.value.toLowerCase()))) {
      return this.parseJoinStage();
    }

    if (cmdToken.type === TokenType.WHERE || cmdName === 'where') {
      return this.parseWhereStage();
    }

    if (cmdToken.type === TokenType.STATS || cmdName === 'stats') {
      return this.parseStatsStage();
    }

    if (cmdName === 'eventstats' || cmdName === 'streamstats') return this.parseStatsStage();

    if (cmdToken.type === TokenType.FIELDS || cmdName === 'fields') {
      return this.parseFieldsStage();
    }

    if (cmdName === 'table') {
      return { ...this.parseFieldsStage(), commandName: 'table' };
    }

    if (cmdToken.type === TokenType.SORT || cmdName === 'sort') {
      return this.parseSortStage();
    }

    if (cmdToken.type === TokenType.RENAME || cmdName === 'rename') {
      return this.parseRenameStage();
    }

    if (cmdToken.type === TokenType.EVAL || cmdName === 'eval') {
      return this.parseEvalStage();
    }

    if (cmdToken.type === TokenType.HEAD || cmdName === 'head') {
      return this.parseHeadStage();
    }

    if (cmdToken.type === TokenType.DEDUP || cmdName === 'dedup') {
      return this.parseDedupStage();
    }

    if (cmdName === 'lookup') return this.parseLookupStage();
    if (['rex', 'parse', 'regex'].includes(cmdName)) return this.parsePatternStage();
    if (cmdName === 'bin' || cmdName === 'timechart') return this.parseOptionStage();

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
    const startToken = this.advance();
    const command = startToken.value.toLowerCase();
    const allowed = command === 'streamstats'
      ? ['bucket_nullable', 'current', 'window', 'global', 'reset_before', 'reset_after']
      : ['bucket_nullable'];
    while (allowed.includes(this.peek().value.toLowerCase()) && this.tokens[this.current + 1]?.type === TokenType.ASSIGN) {
      const option = this.advance().value.toLowerCase();
      this.advance();
      if (option === 'window') {
        if (!this.match(TokenType.NUMBER_LITERAL) || !Number.isInteger(Number(this.previous().value))) {
          this.recordError('window requires an integer', this.peek().span);
        }
      } else if (option.startsWith('reset_')) {
        this.parseExpression();
      } else if (!this.match(TokenType.BOOLEAN_LITERAL)) {
        this.recordError(`${option} requires a boolean value`, this.peek().span);
      }
    }
    const aggregations = this.parseStatsAggregations();
    let groupBy: IdentifierNode[] = [];
    const groupByExpressions: NonNullable<StatsStageNode['groupByExpressions']> = [];

    // Optional: 'by' <field-list>
    if (this.match(TokenType.BY)) {
      do {
        const expr = this.parsePrimary();
        if (expr.type === 'Identifier' || expr.type === 'FunctionCall') {
          const aliasIdentifier = this.match(TokenType.AS)
            ? this.parseFieldIdentifier('Expected alias after as')
            : undefined;
          const alias = aliasIdentifier?.name;
          const outputName = alias || (expr.type === 'Identifier' ? (expr as IdentifierNode).name : undefined);
          groupByExpressions.push({ expression: expr, outputName, outputSpan: aliasIdentifier?.span });
          if (alias || expr.type === 'Identifier') {
            groupBy.push(createIdentifierNode(outputName!, false, expr.span));
          }
        } else {
          this.recordError("Expected field or span expression in stats 'by' clause", expr.span);
        }
      } while (this.match(TokenType.COMMA));
    }

    const endPos = this.previous().span.end;
    const span: Span = {
      start: startToken.span.start,
      end: endPos,
    };

    return { ...createStatsStageNode(aggregations, groupBy, span), commandName: command, groupByExpressions };
  }

  private parseStatsAggregations(): FunctionCallNode[] {
    const aggregations: FunctionCallNode[] = [];
    // Parse aggregation function list until 'by' or next pipe/EOF
    while (!this.isAtEnd() && !this.check(TokenType.PIPE) && !this.check(TokenType.BY)) {
      const expr = this.parsePrimary();
      const aggregation = expr.type === 'FunctionCall'
        ? expr as FunctionCallNode
        : expr.type === 'Identifier' && (expr as IdentifierNode).name.toLowerCase() === 'count'
          ? createFunctionCallNode((expr as IdentifierNode).name, [], expr.span)
          : undefined;
      if (aggregation) {
        if (this.match(TokenType.AS)) {
          const alias = this.parseFieldIdentifier('Expected aggregation alias after as');
          aggregation.alias = alias?.name;
          aggregation.aliasSpan = alias?.span;
        }
        aggregations.push(aggregation);
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
    const fields: IdentifierNode[] = [];
    let notation: 'prefix' | 'suffix' | undefined;
    if (this.check(TokenType.NUMBER_LITERAL)) {
      const count = this.advance();
      if (!Number.isInteger(Number(count.value))) this.recordError('Sort count must be an integer', count.span);
      if (this.isAtEnd() || this.check(TokenType.PIPE)) {
        this.recordError('Expected field name in sort command after count', count.span);
      }
    }

    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      const prefix = this.match(TokenType.PLUS) ? '+' : this.match(TokenType.MINUS) ? '-' : undefined;
      if (prefix) {
        if (notation === 'suffix') this.recordError('Cannot mix prefix and suffix sort directions', this.previous().span);
        notation = 'prefix';
        direction ??= prefix;
      }
      let field: IdentifierNode | null;
      if (['auto', 'str', 'ip', 'num'].includes(this.peek().value.toLowerCase()) &&
          this.tokens[this.current + 1]?.type === TokenType.LPAREN) {
        const wrapper = this.advance();
        this.advance();
        field = this.parseFieldIdentifier('Expected field in sort type wrapper');
        if (!this.match(TokenType.RPAREN)) this.recordError('Expected closing parenthesis in sort type wrapper', this.peek().span);
        if (field) field = createIdentifierNode(field.name, field.isBacktickQuoted, {
          start: wrapper.span.start, end: this.previous().span.end,
        });
      } else {
        field = this.parseFieldIdentifier('Expected field name in sort command');
      }
      if (!field) break;
      fields.push(field);
      const suffix = this.peek().value.toLowerCase();
      if (['asc', 'desc', 'a', 'd'].includes(suffix)) {
        if (notation === 'prefix') this.recordError('Cannot mix prefix and suffix sort directions', this.peek().span);
        notation = 'suffix';
        this.advance();
      }
      if (!this.match(TokenType.COMMA)) break;
    }

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

  private parseEvalStage(): EvalStageNode {
    const startToken = this.advance();
    const assignments: EvalStageNode['assignments'] = [];

    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      const field = this.parseFieldIdentifier('Expected field name in eval assignment');
      if (!field) {
        this.synchronizeToNextPipe();
        break;
      }
      if (!this.match(TokenType.ASSIGN)) {
        this.recordError("Expected '=' after eval field", this.peek().span);
        this.synchronizeToNextPipe();
        break;
      }
      const value = this.parseExpression();
      assignments.push({ field, value });
      if (this.check(TokenType.PIPE) || this.isAtEnd()) break;
      if (!this.match(TokenType.COMMA)) {
        this.recordError('Expected comma between eval assignments', this.peek().span);
        this.synchronizeToNextPipe();
        break;
      }
      if (this.check(TokenType.PIPE) || this.isAtEnd()) {
        this.recordError('Expected assignment after comma', this.peek().span);
      }
    }

    return createEvalStageNode(assignments, {
      start: startToken.span.start,
      end: this.previous().span.end,
    });
  }

  private parseHeadStage(): HeadStageNode {
    const startToken = this.advance();
    let count: number | undefined;
    if (this.check(TokenType.NUMBER_LITERAL)) {
      count = Number(this.advance().value);
    }
    if (!this.check(TokenType.PIPE) && !this.isAtEnd()) {
      this.recordError('Unexpected argument to head; expected a positive integer', this.peek().span);
      this.synchronizeToNextPipe();
    }
    return createHeadStageNode(count, {
      start: startToken.span.start,
      end: this.previous().span.end,
    });
  }

  private parseDedupStage(): DedupStageNode {
    const startToken = this.advance();
    const count = this.check(TokenType.NUMBER_LITERAL) ? Number(this.advance().value) : undefined;
    const fields: IdentifierNode[] = [];
    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      const option = this.peek().value.toLowerCase();
      if (['keepempty', 'consecutive'].includes(option) && this.tokens[this.current + 1]?.type === TokenType.ASSIGN) break;
      const field = this.parseFieldIdentifier('Expected field name in dedup command');
      if (!field) break;
      fields.push(field);
      if (!this.match(TokenType.COMMA)) break;
    }
    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      const option = this.peek().value.toLowerCase();
      if (!['keepempty', 'consecutive'].includes(option)) break;
      this.advance();
      if (!this.match(TokenType.ASSIGN) || !this.match(TokenType.BOOLEAN_LITERAL)) {
        this.recordError(`Expected boolean value for ${option}`, this.peek().span);
        break;
      }
    }
    if (!this.check(TokenType.PIPE) && !this.isAtEnd()) {
      this.recordError('Unexpected argument in dedup command', this.peek().span);
      this.synchronizeToNextPipe();
    }
    return createDedupStageNode(count, fields, {
      start: startToken.span.start,
      end: this.previous().span.end,
    });
  }

  private parseLookupStage(): LookupStageNode {
    const start = this.advance();
    const index = this.parseFieldIdentifier('Expected lookup index');
    const mappings: LookupStageNode['mappings'] = [];
    const outputs: LookupStageNode['outputs'] = [];
    let outputMode: LookupStageNode['outputMode'];
    while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
      const mode = this.peek().value.toLowerCase();
      if (mode === 'replace' || mode === 'append' || mode === 'output') {
        outputMode = mode === 'append' ? 'append' : 'replace';
        this.advance();
        break;
      }
      const lookup = this.parseFieldIdentifier('Expected lookup mapping field');
      if (!lookup) break;
      const source = this.match(TokenType.AS) ? this.parseFieldIdentifier('Expected source mapping field') ?? undefined : undefined;
      mappings.push({ lookup, source });
      if (!this.match(TokenType.COMMA) && !['replace', 'append', 'output'].includes(this.peek().value.toLowerCase())) break;
    }
    if (outputMode) {
      do {
        const input = this.parseFieldIdentifier('Expected lookup output field');
        if (!input) break;
        const output = this.match(TokenType.AS) ? this.parseFieldIdentifier('Expected output alias') ?? undefined : undefined;
        outputs.push({ input, output });
      } while (this.match(TokenType.COMMA));
    }
    if (!index || mappings.length === 0 || (outputMode && outputs.length === 0)) {
      this.recordError('Lookup requires an index, mapping field, and any selected output fields', start.span);
    }
    if (!this.check(TokenType.PIPE) && !this.isAtEnd()) {
      this.recordError('Unexpected lookup argument', this.peek().span);
      this.synchronizeToNextPipe();
    }
    return {
      type: 'LookupStage', commandName: 'lookup', index: index ?? createIdentifierNode('', false, start.span),
      mappings, outputMode, outputs, span: { start: start.span.start, end: this.previous().span.end },
    };
  }

  private parsePatternStage(): PatternStageNode {
    const start = this.advance();
    const command = start.value.toLowerCase();
    const options: PatternStageNode['options'] = {};
    let mode: string | undefined;
    if (command === 'rex') {
      while (['field', 'mode'].includes(this.peek().value.toLowerCase()) &&
             this.tokens[this.current + 1]?.type === TokenType.ASSIGN) {
        const option = this.advance().value.toLowerCase();
        this.advance();
        const value = this.advance();
        options[option] = value.value;
        if (option === 'mode') mode = value.value.toLowerCase();
      }
    }
    const field = command === 'rex'
      ? createIdentifierNode(String(options.field ?? ''), false, start.span)
      : this.parseFieldIdentifier(`Expected field after ${command}`);
    if (command === 'regex' && !this.match(TokenType.ASSIGN, TokenType.NOT_EQUALS)) {
      this.recordError('Expected = or != after regex field', this.peek().span);
    }
    const patternToken = this.peek();
    const pattern = this.match(TokenType.STRING_LITERAL)
      ? createLiteralNode(patternToken.value, patternToken.value, patternToken.span)
      : createLiteralNode('', '', patternToken.span);
    if (patternToken.type !== TokenType.STRING_LITERAL || !field?.name) {
      this.recordError(`${command} requires a field and quoted pattern`, patternToken.span);
    }
    if (command === 'rex') {
      while (!this.isAtEnd() && !this.check(TokenType.PIPE)) {
        const option = this.peek().value.toLowerCase();
        if (!['max_match', 'offset_field'].includes(option) || this.tokens[this.current + 1]?.type !== TokenType.ASSIGN) break;
        this.advance();
        this.advance();
        const value = this.advance();
        options[option] = value.value;
        if (option === 'max_match' && (!Number.isInteger(Number(value.value)) || Number(value.value) < 0)) {
          this.recordError('max_match requires a nonnegative integer', value.span);
        }
      }
      if (mode !== 'sed' && !/\(\?<\w+>/.test(String(pattern.value))) {
        this.recordError('rex extract pattern requires a named capture group', patternToken.span);
      }
    }
    if (!this.check(TokenType.PIPE) && !this.isAtEnd()) {
      this.recordError(`Unexpected ${command} argument`, this.peek().span);
      this.synchronizeToNextPipe();
    }
    return {
      type: 'PatternStage', commandName: command, field: field ?? createIdentifierNode('', false, start.span),
      pattern, mode, options, span: { start: start.span.start, end: this.previous().span.end },
    };
  }

  private parseOptionStage(): OptionStageNode {
    const start = this.advance();
    const command = start.value.toLowerCase();
    const options: OptionStageNode['options'] = {};
    let field: IdentifierNode | undefined;
    let aggregation: FunctionCallNode | undefined;
    let groupBy: IdentifierNode | undefined;
    if (command === 'bin') field = this.parseFieldIdentifier('Expected field after bin') ?? undefined;
    const allowed = command === 'bin'
      ? ['span', 'aligntime', 'start', 'end']
      : ['timefield', 'span', 'limit', 'useother', 'usenull', 'nullstr'];
    while (allowed.includes(this.peek().value.toLowerCase()) && this.tokens[this.current + 1]?.type === TokenType.ASSIGN) {
      const name = this.advance().value.toLowerCase();
      this.advance();
      const value = this.peek();
      if (![TokenType.IDENTIFIER, TokenType.STRING_LITERAL, TokenType.NUMBER_LITERAL, TokenType.BOOLEAN_LITERAL].includes(value.type)) {
        this.recordError(`Expected value for ${name}`, value.span);
        break;
      }
      this.advance();
      options[name] = value.type === TokenType.IDENTIFIER
        ? createIdentifierNode(value.value, false, value.span)
        : createLiteralNode(value.value, value.value, value.span);
      if (['limit', 'start', 'end'].includes(name) && !Number.isFinite(Number(value.value))) {
        this.recordError(`${name} requires a number`, value.span);
      }
      if (['useother', 'usenull'].includes(name) && value.type !== TokenType.BOOLEAN_LITERAL) {
        this.recordError(`${name} requires a boolean`, value.span);
      }
    }
    if (command === 'timechart') {
      const expr = this.parsePrimary();
      if (expr.type === 'FunctionCall') {
        aggregation = expr as FunctionCallNode;
        if (this.match(TokenType.AS)) {
          const alias = this.parseFieldIdentifier('Expected aggregation alias after as');
          aggregation.alias = alias?.name;
          aggregation.aliasSpan = alias?.span;
        }
      } else this.recordError('timechart requires one aggregation function', expr.span);
      if (this.match(TokenType.BY)) groupBy = this.parseFieldIdentifier('Expected timechart group field') ?? undefined;
      if (this.match(TokenType.COMMA)) this.recordError('timechart supports only one aggregation function', this.previous().span);
    } else if (!field) {
      this.recordError('bin requires a field', start.span);
    }
    if (!this.check(TokenType.PIPE) && !this.isAtEnd()) {
      this.recordError(`Unexpected ${command} argument`, this.peek().span);
      this.synchronizeToNextPipe();
    }
    return { type: 'OptionStage', commandName: command, options, field, aggregation, groupBy,
      span: { start: start.span.start, end: this.previous().span.end } };
  }

  private parseJoinStage(): JoinStageNode {
    const start = this.peek();
    let joinType: string | undefined;
    if (this.peek().value.toLowerCase() !== 'join') {
      joinType = this.advance().value.toLowerCase();
      if (['semi', 'anti'].includes(this.peek().value.toLowerCase())) joinType += ` ${this.advance().value.toLowerCase()}`;
    }
    if (this.peek().value.toLowerCase() !== 'join') this.recordError('Expected join command', this.peek().span);
    else this.advance();
    const options: JoinStageNode['options'] = {};
    while (['type', 'overwrite', 'max', 'left', 'right'].includes(this.peek().value.toLowerCase()) &&
           this.tokens[this.current + 1]?.type === TokenType.ASSIGN) {
      const option = this.advance().value.toLowerCase();
      this.advance();
      const value = this.advance();
      options[option] = value.value;
      if (option === 'type') joinType = value.value.toLowerCase();
      if (option === 'max' && (!Number.isInteger(Number(value.value)) || Number(value.value) < 0)) {
        this.recordError('join max requires a nonnegative integer', value.span);
      }
      if (option === 'overwrite' && value.type !== TokenType.BOOLEAN_LITERAL) {
        this.recordError('join overwrite requires a boolean', value.span);
      }
    }
    let criteria: ExpressionNode | undefined;
    const fields: IdentifierNode[] = [];
    if (['on', 'where'].includes(this.peek().value.toLowerCase())) {
      this.advance();
      criteria = this.parseExpression();
    } else if (!this.check(TokenType.LBRACKET) && !this.isAtEnd() && !this.check(TokenType.PIPE)) {
      do {
        const field = this.parseFieldIdentifier('Expected join field');
        if (field) fields.push(field);
        else break;
      } while (this.match(TokenType.COMMA));
    }
    let dataset: JoinStageNode['dataset'];
    if (this.match(TokenType.LBRACKET)) {
      const nestedStart = this.current;
      let depth = 1;
      while (!this.isAtEnd() && depth > 0) {
        if (this.peek().type === TokenType.LBRACKET) depth++;
        if (this.peek().type === TokenType.RBRACKET) depth--;
        if (depth) this.advance();
      }
      if (depth > 0) this.recordError("Unclosed join subquery: expected ']'", start.span);
      const inner = this.tokens.slice(nestedStart, this.current);
      const eofSpan = this.peek().span;
      const subquery = new PplParser([...inner, { type: TokenType.EOF, value: '', span: eofSpan }]).parse();
      dataset = subquery;
      this.match(TokenType.RBRACKET);
    } else if (!this.check(TokenType.PIPE) && !this.isAtEnd()) {
      dataset = this.parseFieldIdentifier('Expected join dataset') ?? undefined;
    }
    const datasetAlias = this.match(TokenType.AS)
      ? this.parseFieldIdentifier('Expected dataset alias') ?? undefined
      : undefined;
    if (!dataset || (!criteria && fields.length === 0 && !('left' in options))) {
      this.recordError('join requires a dataset and join fields or criteria', start.span);
    }
    if (!this.check(TokenType.PIPE) && !this.isAtEnd()) {
      this.recordError('Unexpected join argument', this.peek().span);
      this.synchronizeToNextPipe();
    }
    return { type: 'JoinStage', commandName: 'join', joinType, options, criteria, fields, dataset, datasetAlias,
      span: { start: start.span.start, end: this.previous().span.end } };
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
    const lambda = this.parseLambdaExpression();
    if (lambda) return lambda;
    return this.parseLogicalOr();
  }

  private parseLambdaExpression(): ExpressionNode | null {
    let cursor = this.current;
    const parenthesized = this.tokens[cursor]?.type === TokenType.LPAREN;
    if (parenthesized) cursor++;
    const parameterTokens: Token[] = [];
    while (this.tokens[cursor] && this.isFieldIdentifierToken(this.tokens[cursor], true)) {
      parameterTokens.push(this.tokens[cursor++]);
      if (!parenthesized || this.tokens[cursor]?.type !== TokenType.COMMA) break;
      cursor++;
      if (!this.tokens[cursor] || !this.isFieldIdentifierToken(this.tokens[cursor], true)) return null;
    }
    if (parameterTokens.length === 0) return null;
    if (parenthesized) {
      if (this.tokens[cursor]?.type !== TokenType.RPAREN) return null;
      cursor++;
    }
    if (this.tokens[cursor]?.type !== TokenType.ARROW) return null;
    const start = this.peek().span.start;
    this.current = cursor + 1;
    const parameters = parameterTokens.map((token) => createIdentifierNode(token.value, this.isBacktickQuoted(token), token.span));
    const body = this.parseExpression();
    return createLambdaExpressionNode(parameters, body, { start, end: body.span.end });
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
    let expr = this.parseLogicalNot();

    while (this.match(TokenType.AND)) {
      const op = this.previous();
      const right = this.parseLogicalNot();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseLogicalNot(): ExpressionNode {
    if (this.match(TokenType.NOT)) {
      const op = this.previous();
      const right = this.parseLogicalNot();
      return createUnaryExpressionNode(op.value, right, { start: op.span.start, end: right.span.end });
    }
    return this.parseEquality();
  }

  private parseEquality(): ExpressionNode {
    let expr = this.parseComparison();

    while (
      this.match(TokenType.EQUALS) ||
      this.match(TokenType.NOT_EQUALS) ||
      this.match(TokenType.ASSIGN) ||
      this.match(TokenType.LIKE) ||
      this.match(TokenType.IN)
    ) {
      const op = this.previous();
      if (op.type === TokenType.IN) {
        expr = this.parseInExpression(expr);
        continue;
      }
      const right = this.parseComparison();
      const span: Span = { start: expr.span.start, end: right.span.end };
      expr = createBinaryExpressionNode(expr, op.value, right, span);
    }

    return expr;
  }

  private parseInExpression(left: ExpressionNode): InExpressionNode {
    if (!this.match(TokenType.LPAREN)) {
      this.recordError("Expected '(' after IN", this.peek().span);
      return { type: 'InExpression', left, values: [], span: left.span };
    }

    const values: ExpressionNode[] = [];
    if (this.check(TokenType.RPAREN)) {
      this.recordError('Expected at least one value in IN list', this.peek().span);
    } else {
      do {
        if (this.check(TokenType.RPAREN)) {
          this.recordError('Expected value after comma in IN list', this.peek().span);
          break;
        }
        values.push(this.parseExpression());
      } while (this.match(TokenType.COMMA));
    }

    if (!this.match(TokenType.RPAREN)) {
      this.recordError("Expected ')' after IN list", this.peek().span);
    }
    return { type: 'InExpression', left, values, span: { start: left.span.start, end: this.previous().span.end } };
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
    if (this.match(TokenType.MINUS) || this.match(TokenType.PLUS)) {
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
    if (this.isFieldIdentifierToken(this.peek(), true) ||
        (this.tokens[this.current + 1]?.type === TokenType.LPAREN &&
         [TokenType.EVAL, TokenType.LIKE, TokenType.IN].includes(this.peek().type))) {
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
    if (calleeToken.value.toLowerCase() === 'cast') {
      const expression = this.parseExpression();
      if (!this.match(TokenType.AS)) {
        return this.recordError("Expected 'AS' and a target type in CAST expression", this.peek().span);
      }
      if (!this.check(TokenType.IDENTIFIER)) {
        return this.recordError('Expected target type after AS in CAST expression', this.peek().span);
      }
      const targetType = this.advance();
      if (!this.match(TokenType.RPAREN)) {
        this.recordError("Unclosed CAST expression: expected ')'", this.peek().span, ')');
      }
      return createCastExpressionNode(
        expression,
        targetType.value.toLowerCase(),
        targetType.span,
        { start: calleeToken.span.start, end: this.previous().span.end }
      );
    }

    const args = this.parseFunctionArguments(calleeToken);

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

  private parseFunctionArguments(calleeToken: Token): ExpressionNode[] {
    if (getFunctionSignature(calleeToken.value)?.special === 'relevance') return this.parseRelevanceArguments();
    if (calleeToken.value.toLowerCase() === 'position') {
      const substring = this.parseComparison();
      if (this.match(TokenType.IN) || this.match(TokenType.COMMA)) {
        return [substring, this.parseExpression()];
      }
      this.recordError("Expected 'IN' or ',' in POSITION call", this.peek().span);
      return [substring];
    }
    const args: ExpressionNode[] = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        if (this.match(TokenType.STAR)) {
          // e.g. count(*)
          const starTok = this.previous();
          args.push(createIdentifierNode('*', false, starTok.span));
        } else if (this.peek().value.toLowerCase() === 'interval') {
          const start = this.advance();
          if (this.check(TokenType.NUMBER_LITERAL)) this.advance();
          if (this.peek().type === TokenType.IDENTIFIER) this.advance();
          args.push(createIdentifierNode('interval', false, { start: start.span.start, end: this.previous().span.end }));
        } else {
          args.push(this.parseExpression());
          if (['from', 'else'].includes(this.peek().value.toLowerCase())) {
            this.advance();
            args.push(this.parseExpression());
          }
        }
      } while (this.match(TokenType.COMMA));
    }
    return args;
  }

  private parseRelevanceArguments(): ExpressionNode[] {
    const args: ExpressionNode[] = [];
    let hasOptions = false;
    if (this.check(TokenType.RPAREN)) return args;
    do {
      if (this.check(TokenType.LBRACKET)) {
        if (args.length !== 0) this.recordError('Relevance field lists must be the first argument.', this.peek().span);
        args.push(this.parseRelevanceFieldList());
      } else if (this.tokens[this.current + 1]?.type === TokenType.ASSIGN) {
        hasOptions = true;
        const option = this.advance();
        this.advance();
        let value: ExpressionNode;
        if (this.isFieldIdentifierToken(this.peek()) && [TokenType.COMMA, TokenType.RPAREN].includes(this.tokens[this.current + 1]?.type)) {
          const token = this.advance();
          value = createLiteralNode(token.value, token.value, token.span);
        } else {
          value = this.parseExpression();
        }
        const argument: NamedArgumentNode = { type: 'NamedArgument', name: option.value, value, span: { start: option.span.start, end: value.span.end } };
        args.push(argument);
      } else {
        if (hasOptions) this.recordError('Positional arguments must precede relevance options.', this.peek().span);
        args.push(this.parseExpression());
      }
    } while (this.match(TokenType.COMMA));
    return args;
  }

  private parseRelevanceFieldList(): ExpressionNode {
    const start = this.advance();
    const fields: RelevanceFieldListNode['fields'] = [];
    if (!this.check(TokenType.RBRACKET)) {
      do {
        const token = this.peek();
        if (token.type !== TokenType.STRING_LITERAL && !this.isFieldIdentifierToken(token)) {
          return this.recordError('Expected a field name in relevance field list. Wildcards must be quoted.', token.span);
        }
        this.advance();
        const field = createIdentifierNode(token.value, this.isBacktickQuoted(token), token.span);
        let boost: LiteralNode | undefined;
        const caret = this.match(TokenType.CARET);
        if (caret || this.check(TokenType.NUMBER_LITERAL)) {
          if (!this.check(TokenType.NUMBER_LITERAL)) return this.recordError('Expected numeric field boost.', this.peek().span);
          const value = this.advance();
          boost = createLiteralNode(Number(value.value), value.value, value.span);
        }
        fields.push({ field, boost });
      } while (this.match(TokenType.COMMA));
    }
    if (!this.match(TokenType.RBRACKET)) return this.recordError("Unclosed relevance field list: expected ']'.", this.peek().span);
    const list: RelevanceFieldListNode = { type: 'RelevanceFieldList', fields, span: { start: start.span.start, end: this.previous().span.end } };
    return list;
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
