import { HostPosition, HostRange, SourceCoordinateMap, Span } from '../types';

export function offsetToPosition(text: string, offset: number): HostPosition {
  let line = 0;
  let col = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, col };
}

export interface LineMapping {
  hostLine: number;
  hostColOffset: number;
}

export class LineOffsetSourceMap implements SourceCoordinateMap {
  constructor(private readonly lineMap: LineMapping[]) {}

  public translate(snippetSpan: Span): HostRange {
    if (this.lineMap.length === 0) {
      return {
        start: { line: snippetSpan.start.line, col: snippetSpan.start.col },
        end: { line: snippetSpan.end.line, col: snippetSpan.end.col },
      };
    }

    const startMapping =
      this.lineMap[snippetSpan.start.line] ||
      this.lineMap[this.lineMap.length - 1];

    const endMapping =
      this.lineMap[snippetSpan.end.line] ||
      this.lineMap[this.lineMap.length - 1];

    return {
      start: {
        line: startMapping.hostLine,
        col: Math.max(0, startMapping.hostColOffset + snippetSpan.start.col),
      },
      end: {
        line: endMapping.hostLine,
        col: Math.max(0, endMapping.hostColOffset + snippetSpan.end.col),
      },
    };
  }
}
