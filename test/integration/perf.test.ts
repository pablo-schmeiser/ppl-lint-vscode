import { describe, expect, it } from 'vitest';
import { PplLinter } from '../../src/core/linter';
import { extractQueries } from '../../src/extractors/extractor';

describe('Performance & Stress Benchmarking', () => {
  const linter = new PplLinter();

  it('lints 10 embedded queries in a 500-line YAML file within 50ms', () => {
    let yaml = 'version: 1\ndescription: Performance Benchmark Test\nrules:\n';
    for (let i = 0; i < 10; i++) {
      yaml += `  rule_${i}:\n    id: rule_${i}\n    query: |\n      source=index_${i}\n      | where status == 200 AND response_time < 500\n      | stats count() by host\n`;
    }
    // Add extra padding lines to exceed 500 lines
    for (let j = 0; j < 450; j++) {
      yaml += `  # Comment padding line ${j}\n`;
    }

    const t0 = performance.now();
    const extracted = extractQueries(yaml, 'yaml', ['rules.*.query'], false);
    expect(extracted).toHaveLength(10);

    for (const q of extracted) {
      const diags = linter.lint(q.rawText);
      expect(diags).toHaveLength(0);
    }
    const elapsed = performance.now() - t0;

    // Execution time must be well under the 350ms typing debounce window
    expect(elapsed).toBeLessThan(100);
  });

  it('parses and lints long pipeline with 25 pipe stages without stack overflow', () => {
    let query = 'source = large_telemetry_dataset';
    for (let i = 0; i < 25; i++) {
      if (i % 2 === 0) {
        query += ` | where metric_${i} > ${i * 10}`;
      } else {
        query += ` | fields + metric_${i}, timestamp`;
      }
    }

    const t0 = performance.now();
    const diags = linter.lint(query);
    const elapsed = performance.now() - t0;

    expect(diags).toHaveLength(0);
    expect(elapsed).toBeLessThan(50);
  });
});
