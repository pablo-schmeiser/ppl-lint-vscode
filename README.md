# PPL Linter for Visual Studio Code

[![CI Status](https://github.com/pablo-schmeiser/ppl-lint-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/pablo-schmeiser/ppl-lint-vscode/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/github/actions/workflow/status/pablo-schmeiser/ppl-lint-vscode/ci.yml?branch=main&label=tests)](https://github.com/pablo-schmeiser/ppl-lint-vscode/actions/workflows/ci.yml)
[![Build](https://img.shields.io/github/actions/workflow/status/pablo-schmeiser/ppl-lint-vscode/ci.yml?branch=main&label=build)](https://github.com/pablo-schmeiser/ppl-lint-vscode/actions/workflows/ci.yml)
[![Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/pablo-schmeiser.ppl-lint-vscode?color=blue&label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=pablo-schmeiser.ppl-lint-vscode)
[![Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/pablo-schmeiser.ppl-lint-vscode)](https://marketplace.visualstudio.com/items?itemName=pablo-schmeiser.ppl-lint-vscode)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Open VSX](https://img.shields.io/open-vsx/v/pablo-schmeiser/ppl-lint-vscode?color=purple&label=Open%20VSX)](https://open-vsx.org/extension/pablo-schmeiser/ppl-lint-vscode)

A Visual Studio Code extension for linting **PPL (Piped Processing Language)** queries—both in standalone files (`.ppl`, `.pplquery`, `.query`) and seamlessly embedded within structured configurations (**YAML**, **TOML**, and **JSON**).

---

## Why PPL Linter?

Piped Processing Language (PPL) is widely used across log management and analytics engines like **[OpenSearch](https://opensearch.org/)** (*GitHub: [opensearch-project](https://github.com/opensearch-project)*) and **[Elasticsearch](https://www.elastic.co/elasticsearch)** for pipe-delimited data exploration (e.g., `source=logs | where status >= 500 | stats count() by service`).

In production environments, analytical queries rarely live only in isolated `.ppl` files. Instead, they are embedded inside:

- **YAML**: Alerting monitors, detection rules (Sigma, Elastic/OpenSearch security rules), Kubernetes CRDs, and CI/CD pipelines.
- **TOML**: Telemetry agent configurations (Vector, Telegraf, Fluentbit) and ingestion transforms.
- **JSON**: Saved dashboard queries, notebook cells, and API payload definitions.

This extension features a **bidirectional CST Source-Mapper** that translates PPL syntax errors and rule diagnostics directly to the exact line and column inside your parent configuration file—accurately accounting for block scalars (`|`, `|-`, `|+`), folded scalars (`>`), and multi-level indentation.

---

## Key Features

- ⚡ **First-Class Standalone Linting**: Instant, debounced diagnostics on typing for `.ppl`, `.pplquery`, and `.query` files.
- 🗺️ **Zero-Drift Embedded Source-Mapping**: Pinpoint accuracy for queries embedded in YAML, TOML, and JSON files without line/column offset drift.
- 🛡️ **Resilient Parser with Error Recovery**: Parsing recovers across `|` pipes so syntax errors in one stage never cascade down the pipeline.
- 💡 **Interactive Quick-Fixes (CodeActions)**: One-click fixes for command typos (powered by Levenshtein distance), missing source commands, and assignment operators in conditions (`Ctrl+.` or `Cmd+.`).
- 📖 **Command Documentation Hovers**: Hover over any PPL command (`where`, `stats`, `eval`, `dedup`, `sort`, `rename`, `grok`, etc.) to view syntax templates, descriptions, and official OpenSearch documentation links.
- 🎨 **TextMate Syntax Highlighting**: Rich colorization for commands, functions, operators, comments, and identifiers.

---

## Standard Diagnostic Rules Catalog

| Rule ID | Rule Name | Default Severity | Description & Automated Fix |
| :--- | :--- | :---: | :--- |
| **`PPL001`** | `SyntaxError` | `error` | Catches syntax errors (unclosed quotes/parentheses, trailing pipes). |
| **`PPL002`** | `MissingSource` | `error` | Pipeline must begin with `source=<index>` or `search [source=]<index>`. Offers quick-fix: `Prepend 'source='`. |
| **`PPL003`** | `UnknownCommand` | `error` | Unknown command name. Suggests closest match (e.g. `stat` -> `stats`). |
| **`PPL004`** | `InvalidArguments` | `error` | Missing required arguments (e.g. `stats` without aggregation functions). |
| **`PPL005`** | `UnknownFunction` | `warning` | Flags unknown functions in expressions and aggregations with similarity hints. |
| **`PPL006`** | `LateFilterWarning` | `warning` | Warns when `where` is placed after heavy operations (`sort`, `stats`, `dedup`) which causes performance degradation. |
| **`PPL007`** | `AssignmentInCondition` | `warning` | Flags assignment operator `=` in boolean expressions. Offers quick-fix: `Replace '=' with '=='`. |

---

## Configuration Reference

Customize the linter in your workspace or user `settings.json` under `pplLinter`:

```jsonc
{
  // Enable or disable PPL linting globally
  "pplLinter.enabled": true,

  // Standalone file mappings
  "pplLinter.standalone": {
    "fileExtensions": [".ppl", ".pplquery", ".query"],
    "languageIds": ["ppl"]
  },

  // Embedded query extraction rules
  "pplLinter.embedded": [
    {
      "id": "yaml-detection-rules",
      "filePattern": "**/*.{yaml,yml}",
      "format": "yaml",
      "keyPatterns": [
        "query",
        "ppl",
        "ppl_query",
        "rule.query",
        "detection.condition",
        "*.query",
        "detectors.*.query",
        "alerts.*.condition.ppl"
      ],
      "heuristicDetection": true
    },
    {
      "id": "toml-agent-configs",
      "filePattern": "**/*.toml",
      "format": "toml",
      "keyPatterns": [
        "query",
        "ppl",
        "*.query",
        "transforms.*.query"
      ],
      "heuristicDetection": true
    },
    {
      "id": "json-dashboards",
      "filePattern": "**/*.json",
      "format": "json",
      "keyPatterns": [
        "ppl",
        "query",
        "ppl_query"
      ],
      "heuristicDetection": false
    }
  ],

  // Custom user-defined pipe commands & functions
  "pplLinter.customCommands": ["trendline", "lookup"],
  "pplLinter.customFunctions": ["custom_scoring", "udf_hash"],

  // User-defined extractor key patterns (additive, exclusion, and replacement)
  "pplLinter.additionalKeyPatterns": ["sigma.*.condition", "custom_query"],
  "pplLinter.excludeKeyPatterns": ["unwanted_query"],
  "pplLinter.overrideDefaultKeyPatterns": false,

  // Rule severity overrides ('error', 'warning', 'info', 'off')
  "pplLinter.rules": {
    "PPL001": "error",
    "PPL002": "error",
    "PPL003": "error",
    "PPL004": "error",
    "PPL005": "warning",
    "PPL006": "warning",
    "PPL007": "warning"
  },

  // Debounce delay in milliseconds for typing
  "pplLinter.debounceMs": 350,
  "pplLinter.lintOnType": true
}
```

---

## Embedded Examples

### 1. OpenSearch / Elasticsearch Alert Rule in YAML

```yaml
id: alert_high_error_rate
title: High 5xx HTTP Error Rate
trigger:
  schedule: "*/5 * * * *"
  condition:
    query: |
      source=http_access_logs
      | where status >= 500
      | stats count() by host
      | where count > 50
```

### 2. Vector Telemetry Agent Config in TOML

```toml
[transforms.filter_errors]
type = "filter"
query = """
source=app_logs
| where level == 'ERROR'
| fields timestamp, host, message
"""
```

### 3. Dashboard Saved Object in JSON

```json
{
  "id": "saved-search-cpu",
  "attributes": {
    "title": "High CPU Usage Search",
    "query": "source=system_metrics | where cpu_pct > 90 | head 50"
  }
}
```

---

## Installation

- **VS Code Marketplace**: Search for `PPL Linter` and click **Install**.
- **Open VSX Registry**: Available for VSCodium and Eclipse Theia.
- **Manual `.vsix` Installation**:
  ```bash
  code --install-extension ppl-lint-vscode-0.1.0.vsix
  ```

---

## Contributing

We welcome community contributions! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for development setup instructions, architecture guides, and tutorials on adding new rules or extractors.

---

## License

This project is licensed under the [Apache-2.0 License](LICENSE).
