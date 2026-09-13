import * as jsonc from 'jsonc-parser';
import { minimatch } from 'minimatch';
import { ExtractedQuery, StructuredExtractor } from '../types';
import { LineMapping, LineOffsetSourceMap, offsetToPosition } from './sourcemap';

export class JsonExtractor implements StructuredExtractor {
  public format: 'json' = 'json';

  public extract(
    documentText: string,
    keyPatterns: string[] = [],
    heuristic: boolean = false
  ): ExtractedQuery[] {
    const results: ExtractedQuery[] = [];
    if (!documentText.trim()) {
      return results;
    }

    const rootNode = jsonc.parseTree(documentText);
    if (!rootNode) {
      return results;
    }

    const hostLines = documentText.split(/\r?\n/);

    const matchesPattern = (path: string): boolean => {
      if (keyPatterns.length === 0) return false;
      return keyPatterns.some((pattern) => {
        // Strip JSONPath prefix if user used $..prop
        const cleaned = pattern.replace(/^\$\.\.?/, '');
        return (
          minimatch(path, pattern, { dot: true, matchBase: true }) ||
          minimatch(path, cleaned, { dot: true, matchBase: true })
        );
      });
    };

    const isPplHeuristic = (val: string): boolean => {
      return /^\s*(source|search)\s*=/i.test(val);
    };

    const traverse = (node: jsonc.Node, currentPath: string): void => {
      if (!node) return;

      if (node.type === 'object' && node.children) {
        for (const child of node.children) {
          if (child.type === 'property' && child.children?.length === 2) {
            const keyNode = child.children[0];
            const valNode = child.children[1];
            const keyStr = String(keyNode.value);
            const nextPath = currentPath ? `${currentPath}.${keyStr}` : keyStr;

            if (valNode.type === 'string' && typeof valNode.value === 'string') {
              const rawVal = valNode.value;
              const matchedByKey = matchesPattern(nextPath);
              const matchedByHeuristic = heuristic && isPplHeuristic(rawVal);

              if (matchedByKey || matchedByHeuristic) {
                const sourceMap = this.buildSourceMap(valNode, documentText, hostLines);
                results.push({
                  rawText: rawVal,
                  keyPath: nextPath,
                  hostFormat: 'json',
                  sourceMap,
                });
              }
            } else {
              traverse(valNode, nextPath);
            }
          }
        }
      } else if (node.type === 'array' && node.children) {
        node.children.forEach((child, index) => {
          const nextPath = `${currentPath}.${index}`;
          if (child.type === 'string' && typeof child.value === 'string') {
            const rawVal = child.value;
            const matchedByKey = matchesPattern(nextPath);
            const matchedByHeuristic = heuristic && isPplHeuristic(rawVal);

            if (matchedByKey || matchedByHeuristic) {
              const sourceMap = this.buildSourceMap(child, documentText, hostLines);
              results.push({
                rawText: rawVal,
                keyPath: nextPath,
                hostFormat: 'json',
                sourceMap,
              });
            }
          } else {
            traverse(child, nextPath);
          }
        });
      }
    };

    traverse(rootNode, '');
    return results;
  }

  private buildSourceMap(
    node: jsonc.Node,
    documentText: string,
    hostLines: string[]
  ): LineOffsetSourceMap {
    const lineMap: LineMapping[] = [];
    const textVal = String(node.value);
    const snippetLines = textVal.split(/\r?\n/);

    // Node offset is pointing to the opening quote `"`
    const contentStartOffset = node.offset + 1;
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

    return new LineOffsetSourceMap(lineMap);
  }
}

export const jsonExtractor = new JsonExtractor();
