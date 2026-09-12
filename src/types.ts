/**
 * Shared Contract Interfaces for PPL VSCode Linter
 * Strict TypeScript types for AST, Lexer Tokens, Diagnostics, Extractors, and Configurations.
 */

// ==========================================
// 1. Source Location & Tokens
// ==========================================

export interface Position {
  /** 0-indexed line number */
  line: number;
  /** 0-indexed column number */
  col: number;
  /** 0-indexed character offset from start of string */
  offset: number;
}

export interface Span {
  start: Position;
  end: Position;
}

export enum TokenType {
  // Keywords
  SOURCE = 'SOURCE',
  SEARCH = 'SEARCH',
  WHERE = 'WHERE',
  FIELDS = 'FIELDS',
  STATS = 'STATS',
  EVAL = 'EVAL',
  DEDUP = 'DEDUP',
  SORT = 'SORT',
  RENAME = 'RENAME',
  HEAD = 'HEAD',
  TOP = 'TOP',
  RARE = 'RARE',
  GROK = 'GROK',
  BY = 'BY',
  AS = 'AS',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  IN = 'IN',
  LIKE = 'LIKE',
  ISNULL = 'ISNULL',
  ISNOTNULL = 'ISNOTNULL',

  // Symbols & Operators
  PIPE = 'PIPE',                 // |
  ASSIGN = 'ASSIGN',             // =
  EQUALS = 'EQUALS',             // ==
  NOT_EQUALS = 'NOT_EQUALS',     // != or <>
  LT = 'LT',                     // <
  LTE = 'LTE',                   // <=
  GT = 'GT',                     // >
  GTE = 'GTE',                   // >=
  PLUS = 'PLUS',                 // +
  MINUS = 'MINUS',               // -
  STAR = 'STAR',                 // *
  SLASH = 'SLASH',               // /
  PERCENT = 'PERCENT',           // %
  COMMA = 'COMMA',               // ,
  LPAREN = 'LPAREN',             // (
  RPAREN = 'RPAREN',             // )

  // Literals & Identifiers
  IDENTIFIER = 'IDENTIFIER',         // accounts, status, etc.
  STRING_LITERAL = 'STRING_LITERAL', // "foo" or 'foo'
  NUMBER_LITERAL = 'NUMBER_LITERAL', // 123, 4.56
  BOOLEAN_LITERAL = 'BOOLEAN_LITERAL', // true, false
  NULL_LITERAL = 'NULL_LITERAL',     // null

  // Special
  UNKNOWN = 'UNKNOWN',
  EOF = 'EOF'
}

export interface Token {
  type: TokenType;
  value: string;
  span: Span;
  /** True if the token was not properly closed (e.g. unclosed string literal or backtick) */
  unclosed?: boolean;
}

// ==========================================
// 2. Abstract Syntax Tree (AST)
// ==========================================

export type ASTNodeType =
  | 'Pipeline'
  | 'SourceStage'
  | 'WhereStage'
  | 'FieldsStage'
  | 'StatsStage'
  | 'EvalStage'
  | 'SortStage'
  | 'RenameStage'
  | 'HeadStage'
  | 'GenericStage'
  | 'BinaryExpression'
  | 'UnaryExpression'
  | 'FunctionCall'
  | 'Identifier'
  | 'Literal'
  | 'ErrorNode';

export interface BaseASTNode {
  type: ASTNodeType;
  span: Span;
}

export interface IdentifierNode extends BaseASTNode {
  type: 'Identifier';
  name: string;
  isBacktickQuoted: boolean;
}

export interface LiteralNode extends BaseASTNode {
  type: 'Literal';
  value: string | number | boolean | null;
  raw: string;
}

export interface ExpressionNode extends BaseASTNode {}

export interface BinaryExpressionNode extends ExpressionNode {
  type: 'BinaryExpression';
  left: ExpressionNode;
  operator: string;
  right: ExpressionNode;
}

export interface UnaryExpressionNode extends ExpressionNode {
  type: 'UnaryExpression';
  operator: string;
  argument: ExpressionNode;
}

export interface FunctionCallNode extends ExpressionNode {
  type: 'FunctionCall';
  functionName: string;
  arguments: ExpressionNode[];
}

export interface PipeStageNode extends BaseASTNode {
  commandName: string;
}

export interface SourceStageNode extends PipeStageNode {
  type: 'SourceStage';
  indexName: string;
  isSearchPrefix: boolean;
}

export interface WhereStageNode extends PipeStageNode {
  type: 'WhereStage';
  condition: ExpressionNode;
}

export interface StatsStageNode extends PipeStageNode {
  type: 'StatsStage';
  aggregations: FunctionCallNode[];
  groupBy: IdentifierNode[];
}

export interface FieldsStageNode extends PipeStageNode {
  type: 'FieldsStage';
  mode?: '+' | '-';
  fields: IdentifierNode[];
}

export interface SortStageNode extends PipeStageNode {
  type: 'SortStage';
  direction?: '+' | '-';
  fields: IdentifierNode[];
}

export interface RenameStageNode extends PipeStageNode {
  type: 'RenameStage';
  pairs: Array<{ from: IdentifierNode; to: IdentifierNode }>;
}

export interface GenericStageNode extends PipeStageNode {
  type: 'GenericStage';
  rawArguments: string;
}

export interface ErrorNode extends BaseASTNode {
  type: 'ErrorNode';
  message: string;
  expectedToken?: string;
  foundToken?: string;
}

export interface PipelineNode extends BaseASTNode {
  type: 'Pipeline';
  source: SourceStageNode | ErrorNode;
  stages: PipeStageNode[];
  syntaxErrors: ErrorNode[];
}

// ==========================================
// 3. Diagnostics & Rules Engine
// ==========================================

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'off';

export interface CoreDiagnostic {
  code: string;               // E.g., 'PPL001', 'PPL003'
  message: string;            // E.g., "Unknown command 'stat'. Did you mean 'stats'?"
  severity: 'error' | 'warning' | 'info';
  span: Span;                 // Relative to snippet text
  data?: {
    suggestion?: string;      // Quick-fix replacement string
    replaceSpan?: Span;       // Exact token span to replace
  };
}

export interface RuleContext {
  report(diagnostic: CoreDiagnostic): void;
  getSeverity(ruleId: string): DiagnosticSeverity;
}

export interface LintRule {
  id: string;                 // E.g., 'PPL003'
  name: string;               // E.g., 'UnknownCommand'
  description: string;
  defaultSeverity: DiagnosticSeverity;
  check(ast: PipelineNode, context: RuleContext): void;
}

export interface PplLinterOptions {
  rules?: Record<string, DiagnosticSeverity>;
}

// ==========================================
// 4. Structured Extractors & Source Mapping
// ==========================================

export interface HostPosition {
  line: number;   // 0-indexed line number in host file
  col: number;    // 0-indexed column number in host file
}

export interface HostRange {
  start: HostPosition;
  end: HostPosition;
}

export interface SourceCoordinateMap {
  /**
   * Translates a span in snippet-local coordinates to the host document coordinates.
   */
  translate(snippetSpan: Span): HostRange;
}

export interface ExtractedQuery {
  rawText: string;               // Extracted PPL string ready for lexer
  keyPath: string;               // Dot-path in host file (e.g. "rule.condition.query")
  hostFormat: 'yaml' | 'toml' | 'json';
  sourceMap: SourceCoordinateMap;
}

export interface StructuredExtractor {
  format: 'yaml' | 'toml' | 'json';
  extract(documentText: string, keyPatterns: string[], heuristic: boolean): ExtractedQuery[];
}

// ==========================================
// 5. Configuration Schema Interfaces
// ==========================================

export interface StandaloneConfig {
  fileExtensions: string[];
  languageIds: string[];
}

export interface EmbeddedRuleConfig {
  id: string;
  filePattern: string;
  format: 'yaml' | 'toml' | 'json';
  keyPatterns: string[];
  heuristicDetection: boolean;
}

export interface PplLinterConfig {
  enabled: boolean;
  standalone: StandaloneConfig;
  embedded: EmbeddedRuleConfig[];
  rules: Record<string, DiagnosticSeverity>;
  lintOnType: boolean;
  debounceMs: number;
}
