import { HostPosition, HostRange, SourceCoordinateMap, Span } from '../types';

export class UnmappableSourceMap implements SourceCoordinateMap {
  public translate(): undefined {
    return undefined;
  }

  public toSnippet(): undefined {
    return undefined;
  }
}

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

  public toSnippet(position: HostPosition, snippetText: string): HostPosition | undefined {
    const lines = snippetText.split(/\r?\n/);
    for (let index = 0; index < this.lineMap.length; index++) {
      const mapping = this.lineMap[index];
      const col = position.col - mapping.hostColOffset;
      if (position.line === mapping.hostLine && col >= 0 && col <= (lines[index]?.length ?? -1)) {
        return { line: index, col };
      }
    }
    return undefined;
  }

  public translate(snippetSpan: Span): HostRange | undefined {
    if (this.lineMap.length === 0) {
      return undefined;
    }

    const startMapping = this.lineMap[snippetSpan.start.line];
    const endMapping = this.lineMap[snippetSpan.end.line];
    if (!startMapping || !endMapping) return undefined;

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
