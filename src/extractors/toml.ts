import { minimatch } from 'minimatch';
import * as toml from 'smol-toml';
import { ExtractedQuery, StructuredExtractor } from '../types';
import { LineMapping, LineOffsetSourceMap } from './sourcemap';

export class TomlExtractor implements StructuredExtractor {
  public format: 'toml' = 'toml';

  public extract(
    documentText: string,
    keyPatterns: string[] = [],
    heuristic: boolean = true
  ): ExtractedQuery[] {
    const results: ExtractedQuery[] = [];
    if (!documentText.trim()) {
      return results;
    }

    try {
      toml.parse(documentText);
    } catch {
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

    let currentSection = '';

    let lineIdx = 0;
    while (lineIdx < hostLines.length) {
      const line = hostLines[lineIdx].trim();

      // Comment
      if (line.startsWith('#')) {
        lineIdx++;
        continue;
      }

      // Section header: [section.name] or [[array_section]]
      const sectionMatch = new RegExp(/^\[\[?([a-zA-Z0-9_.-]+)\]\]?$/).exec(line);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        lineIdx++;
        continue;
      }

      // Key-value pair: key = ...
      const kvMatch = new RegExp(/^([a-zA-Z0-9_.-]+)\s*=(.*)$/).exec(line);
      if (kvMatch) {
        const keyName = kvMatch[1];
        const valPart = kvMatch[2].trim();
        const fullKeyPath = currentSection ? `${currentSection}.${keyName}` : keyName;

        // Check for multi-line string: """ or '''
        if (valPart.startsWith('"""') || valPart.startsWith("'''")) {
          const quoteDelim = valPart.substring(0, 3);
          const rawLines: string[] = [];
          const lineMappings: LineMapping[] = [];

          let currentLineIdx = lineIdx;

          const afterQuote = valPart.substring(3);
          if (afterQuote.endsWith(quoteDelim) && afterQuote.length >= 3) {
            // Single line multi-quote string
            const content = afterQuote.substring(0, afterQuote.length - 3);
            if (matchesPattern(fullKeyPath) || (heuristic && isPplHeuristic(content))) {
              const quoteCol = hostLines[lineIdx].indexOf(quoteDelim) + 3;
              lineMappings.push({ hostLine: lineIdx, hostColOffset: quoteCol });
              results.push({
                rawText: content,
                keyPath: fullKeyPath,
                hostFormat: 'toml',
                sourceMap: new LineOffsetSourceMap(lineMappings),
              });
            }
            lineIdx++;
            continue;
          }

          // Multiline multi-quote string
          if (afterQuote.trim().length > 0) {
            rawLines.push(afterQuote);
            const quoteCol = hostLines[lineIdx].indexOf(quoteDelim) + 3;
            lineMappings.push({ hostLine: lineIdx, hostColOffset: quoteCol });
          }

          while (++currentLineIdx < hostLines.length) {
            const curLine = hostLines[currentLineIdx];
            const endIdx = curLine.indexOf(quoteDelim);
            if (endIdx >= 0) {
              const contentBeforeEnd = curLine.substring(0, endIdx);
              if (contentBeforeEnd.length > 0 || rawLines.length === 0) {
                rawLines.push(contentBeforeEnd);
                const indent = curLine.search(/\S/);
                lineMappings.push({
                  hostLine: currentLineIdx,
                  hostColOffset: Math.max(indent, 0),
                });
              }
              lineIdx = currentLineIdx;
              break;
            } else {
              rawLines.push(curLine);
              const indent = curLine.search(/\S/);
              lineMappings.push({
                hostLine: currentLineIdx,
                hostColOffset: Math.max(indent, 0),
              });
            }
          }

          const rawText = rawLines.join('\n');
          if (matchesPattern(fullKeyPath) || (heuristic && isPplHeuristic(rawText))) {
            results.push({
              rawText,
              keyPath: fullKeyPath,
              hostFormat: 'toml',
              sourceMap: new LineOffsetSourceMap(lineMappings),
            });
          }
          lineIdx++;
          continue;
        }

        // Single line string: "..." or '...'
        if (
          (valPart.startsWith('"') && valPart.endsWith('"')) ||
          (valPart.startsWith("'") && valPart.endsWith("'"))
        ) {
          const content = valPart.substring(1, valPart.length - 1);
          if (matchesPattern(fullKeyPath) || (heuristic && isPplHeuristic(content))) {
            const quoteChar = valPart[0];
            const col = hostLines[lineIdx].indexOf(quoteChar, hostLines[lineIdx].indexOf('=')) + 1;
            const lineMappings: LineMapping[] = [
              { hostLine: lineIdx, hostColOffset: col },
            ];

            results.push({
              rawText: content,
              keyPath: fullKeyPath,
              hostFormat: 'toml',
              sourceMap: new LineOffsetSourceMap(lineMappings),
            });
          }
        }
      }

      lineIdx++;
    }

    return results;
  }
}

export const tomlExtractor = new TomlExtractor();
