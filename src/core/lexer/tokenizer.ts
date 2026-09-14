import { Position, Token, TokenType } from '../../types';

const KEYWORDS: Record<string, TokenType> = {
  SOURCE: TokenType.SOURCE,
  SEARCH: TokenType.SEARCH,
  WHERE: TokenType.WHERE,
  FIELDS: TokenType.FIELDS,
  STATS: TokenType.STATS,
  EVAL: TokenType.EVAL,
  DEDUP: TokenType.DEDUP,
  SORT: TokenType.SORT,
  RENAME: TokenType.RENAME,
  HEAD: TokenType.HEAD,
  TOP: TokenType.TOP,
  RARE: TokenType.RARE,
  GROK: TokenType.GROK,
  BY: TokenType.BY,
  AS: TokenType.AS,
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  IN: TokenType.IN,
  LIKE: TokenType.LIKE,
  ISNULL: TokenType.ISNULL,
  ISNOTNULL: TokenType.ISNOTNULL,
};

export class Tokenizer {
  private offset = 0;
  private line = 0;
  private col = 0;
  private tokens: Token[] = [];

  constructor(private readonly input: string) {}

  public tokenize(): Token[] {
    this.offset = 0;
    this.line = 0;
    this.col = 0;
    this.tokens = [];

    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) {
        break;
      }

      const startPos = this.currentPos();
      const char = this.peek();

      // String literals
      if (char === '"' || char === "'") {
        this.tokenizeString(char, startPos);
        continue;
      }

      // Backtick identifiers
      if (char === '`') {
        this.tokenizeBacktickIdentifier(startPos);
        continue;
      }

      // Numbers
      if (this.isDigit(char)) {
        this.tokenizeNumber(startPos);
        continue;
      }

      // Multi-character and single-character operators
      if (char === '|') {
        this.advance();
        this.addToken(TokenType.PIPE, '|', startPos, this.currentPos());
        continue;
      }

      if (char === '=') {
        this.advance();
        if (this.peek() === '=') {
          this.advance();
          this.addToken(TokenType.EQUALS, '==', startPos, this.currentPos());
        } else {
          this.addToken(TokenType.ASSIGN, '=', startPos, this.currentPos());
        }
        continue;
      }

      if (char === '!') {
        this.advance();
        if (this.peek() === '=') {
          this.advance();
          this.addToken(TokenType.NOT_EQUALS, '!=', startPos, this.currentPos());
        } else {
          this.addToken(TokenType.UNKNOWN, '!', startPos, this.currentPos());
        }
        continue;
      }

      if (char === '<') {
        this.advance();
        if (this.peek() === '=') {
          this.advance();
          this.addToken(TokenType.LTE, '<=', startPos, this.currentPos());
        } else if (this.peek() === '>') {
          this.advance();
          this.addToken(TokenType.NOT_EQUALS, '<>', startPos, this.currentPos());
        } else {
          this.addToken(TokenType.LT, '<', startPos, this.currentPos());
        }
        continue;
      }

      if (char === '>') {
        this.advance();
        if (this.peek() === '=') {
          this.advance();
          this.addToken(TokenType.GTE, '>=', startPos, this.currentPos());
        } else {
          this.addToken(TokenType.GT, '>', startPos, this.currentPos());
        }
        continue;
      }

      if (char === '+') {
        this.advance();
        this.addToken(TokenType.PLUS, '+', startPos, this.currentPos());
        continue;
      }

      if (char === '-') {
        this.advance();
        this.addToken(TokenType.MINUS, '-', startPos, this.currentPos());
        continue;
      }

      if (char === '*') {
        this.advance();
        this.addToken(TokenType.STAR, '*', startPos, this.currentPos());
        continue;
      }

      if (char === '/') {
        this.advance();
        this.addToken(TokenType.SLASH, '/', startPos, this.currentPos());
        continue;
      }

      if (char === '%') {
        this.advance();
        this.addToken(TokenType.PERCENT, '%', startPos, this.currentPos());
        continue;
      }

      if (char === ',') {
        this.advance();
        this.addToken(TokenType.COMMA, ',', startPos, this.currentPos());
        continue;
      }

      if (char === '(') {
        this.advance();
        this.addToken(TokenType.LPAREN, '(', startPos, this.currentPos());
        continue;
      }

      if (char === ')') {
        this.advance();
        this.addToken(TokenType.RPAREN, ')', startPos, this.currentPos());
        continue;
      }

      // Identifiers / Keywords
      if (this.isIdentifierStart(char)) {
        this.tokenizeIdentifierOrKeyword(startPos);
        continue;
      }

      // Unknown character
      const unk = this.advance();
      this.addToken(TokenType.UNKNOWN, unk, startPos, this.currentPos());
    }

    const endPos = this.currentPos();
    this.addToken(TokenType.EOF, '', endPos, endPos);
    return this.tokens;
  }

  private isAtEnd(): boolean {
    return this.offset >= this.input.length;
  }

  private peek(ahead = 0): string {
    const idx = this.offset + ahead;
    if (idx >= this.input.length) {
      return '';
    }
    return this.input[idx];
  }

  private advance(): string {
    const char = this.input[this.offset++];
    if (char === '\n') {
      this.line++;
      this.col = 0;
    } else {
      this.col++;
    }
    return char;
  }

  private currentPos(): Position {
    return {
      line: this.line,
      col: this.col,
      offset: this.offset,
    };
  }

  private addToken(
    type: TokenType,
    value: string,
    start: Position,
    end: Position,
    unclosed?: boolean
  ): void {
    this.tokens.push({
      type,
      value,
      span: { start, end },
      ...(unclosed ? { unclosed: true } : {}),
    });
  }

  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
        this.advance();
        continue;
      }

      // Single line comment: // ...
      if (char === '/' && this.peek(1) === '/') {
        this.advance(); // /
        this.advance(); // /
        while (!this.isAtEnd() && this.peek() !== '\n') {
          this.advance();
        }
        continue;
      }

      // Multi-line block comment: /* ... */
      if (char === '/' && this.peek(1) === '*') {
        this.advance(); // /
        this.advance(); // *
        while (!this.isAtEnd()) {
          if (this.peek() === '*' && this.peek(1) === '/') {
            this.advance(); // *
            this.advance(); // /
            break;
          }
          this.advance();
        }
        continue;
      }

      break;
    }
  }

  private tokenizeString(quote: string, startPos: Position): void {
    this.advance(); // consume opening quote
    let value = '';
    let closed = false;

    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === quote) {
        this.advance(); // consume closing quote
        closed = true;
        break;
      }

      if (char === '\n' || char === '\r') {
        break;
      }

      if (char === '\\') {
        this.advance();
        if (!this.isAtEnd()) {
          const escaped = this.advance();
          switch (escaped) {
            case 'n':
              value += '\n';
              break;
            case 't':
              value += '\t';
              break;
            case 'r':
              value += '\r';
              break;
            case '\\':
              value += '\\';
              break;
            case '\'':
              value += '\'';
              break;
            case '"':
              value += '"';
              break;
            default:
              value += escaped;
          }
        }
        continue;
      }

      value += this.advance();
    }

    const endPos = this.currentPos();
    if (!closed) {
      // Unclosed string literal
      this.addToken(TokenType.STRING_LITERAL, value, startPos, endPos, true);
    } else {
      this.addToken(TokenType.STRING_LITERAL, value, startPos, endPos);
    }
  }

  private tokenizeBacktickIdentifier(startPos: Position): void {
    this.advance(); // consume opening `
    let value = '';
    let closed = false;

    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === '`') {
        this.advance(); // consume closing `
        closed = true;
        break;
      }

      if (char === '\n' || char === '\r') {
        break;
      }

      value += this.advance();
    }

    const endPos = this.currentPos();
    if (!closed) {
      this.addToken(TokenType.IDENTIFIER, value, startPos, endPos, true);
    } else {
      this.addToken(TokenType.IDENTIFIER, value, startPos, endPos);
    }
  }

  private tokenizeNumber(startPos: Position): void {
    let value = '';
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value += this.advance();
    }

    if (this.peek() === '.' && this.isDigit(this.peek(1))) {
      value += this.advance(); // .
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    const endPos = this.currentPos();
    this.addToken(TokenType.NUMBER_LITERAL, value, startPos, endPos);
  }

  private tokenizeIdentifierOrKeyword(startPos: Position): void {
    let value = '';
    while (!this.isAtEnd() && this.isIdentifierPart(this.peek())) {
      value += this.advance();
    }

    const upper = value.toUpperCase();
    const endPos = this.currentPos();

    if (upper === 'TRUE' || upper === 'FALSE') {
      this.addToken(TokenType.BOOLEAN_LITERAL, value.toLowerCase(), startPos, endPos);
      return;
    }

    if (upper === 'NULL') {
      this.addToken(TokenType.NULL_LITERAL, value.toLowerCase(), startPos, endPos);
      return;
    }

    if (KEYWORDS[upper]) {
      this.addToken(KEYWORDS[upper], value, startPos, endPos);
      return;
    }

    this.addToken(TokenType.IDENTIFIER, value, startPos, endPos);
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isIdentifierStart(char: string): boolean {
    return (
      (char >= 'a' && char <= 'z') ||
      (char >= 'A' && char <= 'Z') ||
      char === '_' ||
      char === '@'
    );
  }

  private isIdentifierPart(char: string): boolean {
    return (
      this.isIdentifierStart(char) ||
      this.isDigit(char) ||
      char === '.' ||
      char === '-' ||
      char === '*'
    );
  }
}

export function tokenize(input: string): Token[] {
  return new Tokenizer(input).tokenize();
}
