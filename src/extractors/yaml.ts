import { minimatch } from 'minimatch';
import * as YAML from 'yaml';
import { ExtractedQuery, StructuredExtractor } from '../types';
import { LineMapping, LineOffsetSourceMap, offsetToPosition } from './sourcemap';

export class YamlExtractor implements StructuredExtractor {
  public format: 'yaml' = 'yaml';

  public extract(
    documentText: string,
    keyPatterns: string[] = [],
    heuristic: boolean = true
  ): ExtractedQuery[] {
    const results: ExtractedQuery[] = [];
    if (!documentText.trim()) {
      return results;
    }

    let doc: YAML.Document;
    try {
      doc = YAML.parseDocument(documentText, { keepSourceTokens: true });
      if (doc.errors && doc.errors.length > 0) {
        return results;
      }
    } catch {
      return results;
    }

    if (!doc.contents) {
      return results;
    }

    const hostLines = documentText.split(/\r?\n/);

    const matchesPattern = (path: string): boolean => {
      if (keyPatterns.length === 0) return false;
      return keyPatterns.some((pattern) =>
        minimatch(path, pattern, { dot: true, matchBase: true })
      );
    };

    const isPplHeuristic = (val: string): boolean => {
      return /^\s*(source|search)\s*=/i.test(val);
    };

    const visitNode = (node: any, currentPath: string): void => {
      if (!node) return;

      if (YAML.isMap(node)) {
        for (const pair of node.items) {
          const keyStr = String(pair.key && (pair.key as any).value !== undefined ? (pair.key as any).value : pair.key);
          const nextPath = currentPath ? `${currentPath}.${keyStr}` : keyStr;
          visitNode(pair.value, nextPath);
        }
      } else if (YAML.isSeq(node)) {
        node.items.forEach((item, index) => {
          const nextPath = `${currentPath}.${index}`;
          visitNode(item, nextPath);
        });
      } else if (YAML.isScalar(node) && typeof node.value === 'string') {
        const rawVal = node.value;
        const matchedByKey = matchesPattern(currentPath);
        const matchedByHeuristic = heuristic && isPplHeuristic(rawVal);

        if (matchedByKey || matchedByHeuristic) {
          const sourceMap = this.buildSourceMap(node, documentText, hostLines);
          results.push({
            rawText: rawVal,
            keyPath: currentPath,
            hostFormat: 'yaml',
            sourceMap,
          });
        }
      }
    };

    visitNode(doc.contents, '');
    return results;
  }

  private buildSourceMap(
    node: YAML.Scalar,
    documentText: string,
    hostLines: string[]
  ): LineOffsetSourceMap {
    const lineMap: LineMapping[] = [];
    const textVal = String(node.value);
    const snippetLines = textVal.split(/\r?\n/);

    const range = node.range || [0, 0, 0];
    const scalarStartOffset = range[0];

    if (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') {
      const indicatorPos = offsetToPosition(documentText, scalarStartOffset);
      const startHostLine = indicatorPos.line + 1;

      for (let i = 0; i < snippetLines.length; i++) {
        const hostLine = startHostLine + i;
        const hostLineText = hostLines[hostLine] || '';
        const snippetLine = snippetLines[i];

        let hostColOffset = 0;
        if (snippetLine.length > 0) {
          const idx = hostLineText.indexOf(snippetLine);
          if (idx >= 0) {
            hostColOffset = idx;
          } else {
            const indentMatch = hostLineText.search(/\S/);
            hostColOffset = Math.max(indentMatch, 0);
          }
        } else {
          const firstLineIndent = hostLines[startHostLine]?.search(/\S/);
          hostColOffset = Math.max(firstLineIndent ?? 0, 0);
        }

        lineMap.push({ hostLine, hostColOffset });
      }
    } else {
      // Inline scalar (quoted or plain)
      const isQuoted =
        documentText[scalarStartOffset] === '"' ||
        documentText[scalarStartOffset] === "'";
      const contentStartOffset = isQuoted
        ? scalarStartOffset + 1
        : scalarStartOffset;
      const startPos = offsetToPosition(documentText, contentStartOffset);

      for (let i = 0; i < snippetLines.length; i++) {
        const hostLine = startPos.line + i;
        const hostLineText = hostLines[hostLine] || '';
        const hostColOffset =
          i === 0
            ? startPos.col
            : Math.max(0, hostLineText.search(/\S/));

        lineMap.push({ hostLine, hostColOffset });
      }
    }

    return new LineOffsetSourceMap(lineMap);
  }
}

export const yamlExtractor = new YamlExtractor();
