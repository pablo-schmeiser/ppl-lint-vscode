import { TokenType } from '../types';
import { IndexTemplate } from './indexTemplates';
import { tokenize } from './lexer/tokenizer';
import { parsePpl } from './parser/parser';
import { typedFieldScopeAt } from './schemaTypeChecker';

export interface FieldHoverInfo {
  name: string;
  types: string[];
  templates: string[];
  span: { start: number; end: number };
}

export function fieldInfoAt(query: string, offset: number, templates: readonly IndexTemplate[]): FieldHoverInfo | undefined {
  if (!templates.length) return undefined;
  const tokens = tokenize(query);
  const index = tokens.findIndex((token) =>
    token.type === TokenType.IDENTIFIER && token.span.start.offset <= offset && offset < token.span.end.offset
  );
  if (index < 0 || tokens[index + 1]?.type === TokenType.LPAREN) return undefined;

  const source = parsePpl(query).source;
  const token = tokens[index];
  if (source.type !== 'SourceStage' || offset < source.span.end.offset) return undefined;
  const field = typedFieldScopeAt(query, templates, offset)?.get(token.value);
  const types = field?.pplTypes?.length ? field.pplTypes : [];
  if (!field || types.length === 0) return undefined;

  return {
    name: token.value,
    types,
    templates: field.templates,
    span: { start: token.span.start.offset, end: token.span.end.offset },
  };
}