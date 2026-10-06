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

The extension maps diagnostics in source-identical embedded strings to their host-file positions. It suppresses diagnostics when it cannot prove an exact mapping, including decoded escapes and folded YAML scalars; it never applies a quick fix at an approximate position.

TOML extraction currently handles section headers, dotted bare keys, and quoted string values. Inline tables and quoted keys are not extracted yet. Escaped TOML strings are decoded for validation, but diagnostics for them are suppressed until exact host positions are available.

---

## Key Features

- ⚡ **First-Class Standalone Linting**: Instant, debounced diagnostics on typing for `.ppl`, `.pplquery`, and `.query` files.
- 🗺️ **Exact-Only Embedded Locations**: Map diagnostics in supported YAML, TOML, and JSON string forms; skip locations that cannot be mapped exactly.
- 🛡️ **Resilient Parser with Error Recovery**: Parsing recovers across `|` pipes so syntax errors in one stage never cascade down the pipeline.
- 💡 **Interactive Quick-Fixes (CodeActions)**: One-click fixes for command and function typos (`Ctrl+.` or `Cmd+.`). A missing source requires you to supply an index name.
- 📖 **Command Documentation Hovers**: Hover over any PPL command (`where`, `stats`, `eval`, `dedup`, `sort`, `rename`, `grok`, etc.) to view syntax templates, descriptions, and official OpenSearch documentation links.
- **Context-Aware Suggestions**: Suggest pipeline commands after `|`, aggregation functions after `stats`, and PPL functions while writing expressions. Function-argument fields are filtered by type, CAST targets are suggested, and string fields accepted through numeric coercion are marked as potentially unsafe. Lookup completion separates index fields from source fields and carries output fields into later stages; join completion covers options, datasets, aliases, criteria, subqueries, and known output fields.
- **Mapped Field Hovers**: Hover over a field such as `event.type` to see its normalized PPL type and the index template that supplied it. Computed fields show their inferred PPL type and pipeline origin.
- 🎨 **TextMate Syntax Highlighting**: Rich colorization for commands, functions, operators, comments, and identifiers.

The PPL TextMate grammar colors standalone `.ppl`, `.pplquery`, and `.query` files. It includes OpenSearch 3.5 commands such as `lookup`, `rex`, and `streamstats`, their option names, common aggregation/date/IP functions, `@timestamp`-style fields, and interval literals such as `5m`. YAML monitor queries receive diagnostics through extraction but retain YAML highlighting; TextMate coloring does not imply that a command is fully validated by the AST. The syntax names follow the [OpenSearch 3.5 command reference](https://docs.opensearch.org/3.5/sql-and-ppl/ppl/commands/index/) and [function reference](https://docs.opensearch.org/3.5/sql-and-ppl/ppl/functions/). The monitor-specific `lookup ... OUTPUT ...` clause is colored but is not documented in the 3.5 lookup syntax, so verify it against the target cluster.

---

## Standard Diagnostic Rules Catalog

| Rule ID | Rule Name | Default Severity | Description & Automated Fix |
| :--- | :--- | :---: | :--- |
| **`PPL001`** | `SyntaxError` | `error` | Catches syntax errors (unclosed quotes/parentheses, trailing pipes). |
| **`PPL002`** | `MissingSource` | `error` | Pipeline must begin with `source=<index>` or `search [source=]<index>`. Supply the index manually. |
| **`PPL003`** | `UnknownCommand` | `error` | Unknown command name. Suggests closest match (e.g. `stat` -> `stats`). |
| **`PPL004`** | `InvalidArguments` | `error` | Missing required arguments (e.g. `stats` without aggregation functions). |
| **`PPL005`** | `UnknownFunction` | `warning` | Flags unknown functions in expressions and aggregations with similarity hints. |
| **`PPL006`** | `LateFilterWarning` | `warning` | Warns when `where` is placed after heavy operations (`sort`, `stats`, `dedup`) which causes performance degradation. |
| **`PPL008`** | `UnverifiedStage` | `error` | A recognized command has arguments not yet represented in the syntax tree; this does not mean OpenSearch rejects the query. |
| **`PPL009`** | `UnverifiedVersion` | `warning` | Selected version is newer than the 3.5 baseline. |
| **`PPL010`** | `UnsupportedVersion` | `error` | Selected version is invalid or older than 3.5. |
| **`PPL011`** | `UnresolvedSource` | `error` | No configured index template or alias matches the query source. |
| **`PPL012`** | `UnknownOrUntypedField` | `error` | Field is absent from the resolved templates, dynamic-only, or has no supported PPL type. |
| **`PPL013`** | `ConflictingFieldTypes` | `error` | A field use resolves to multiple PPL types across templates for the source. |
| **`PPL014`** | `TypeMismatch` | `error` | Function arguments, casts, or operators use incompatible types. |
| **`PPL015`** | `RiskyImplicitConversion` | `warning` | PPL permits an implicit conversion whose success depends on field values. |

Structured validation covers `source`/`search`, `where`, `fields`, `stats`, `eventstats`, `streamstats`, `eval`, `sort`, `rename`, `head`, `dedup`, `lookup`, `join` with subqueries, `rex`, `parse`, `regex`, `bin`, and `timechart` for the forms exercised by the conformance suite. Other recognized stages are reported as unverified by PPL008. Disable PPL008 for a workspace with `"pplLinter.rules": { "PPL008": "off" }` if a known valid query uses one of these stages. Custom commands remain unverified even when listed in `customCommands`.

Target OpenSearch 3.5 with `pplLinter.openSearchVersion` (default `"3.5"`). Later versions use the same baseline checks and emit PPL009 until their behavior is verified. Server-specific compatibility checks belong in `src/core/compatibility.ts` with a reproduced query, affected version range, and reference. No server-bug exceptions have yet been verified in this repository.

### Documentation conformance tests

Run `pnpm run test:conformance` to run only the [OpenSearch 3.5 conformance suite](test/integration/opensearch-3.5-conformance.test.ts); it also runs as part of `pnpm test`. Run `pnpm run test:thorough` for the full local gate: dependency audit, typecheck, lint, all tests, and production build. The conformance cases and source-page URLs come from the [PPL commands](https://docs.opensearch.org/3.5/sql-and-ppl/ppl/commands/index/) and [functions](https://docs.opensearch.org/3.5/sql-and-ppl/ppl/functions/) references. Positive cases expect no diagnostics; negative cases require a real error, not merely "unknown command" or "validation not implemented." It tests user-visible acceptance, not AST shapes. `dedup consecutive=true` requires the legacy SQL engine, and some join types require a cluster setting; these examples are configuration-dependent. This does not execute queries against OpenSearch or prove runtime behavior.

---

## Configuration Reference

Customize the linter in your workspace or user `settings.json` under `pplLinter`:

```jsonc
{
  // Enable or disable PPL linting globally
  "pplLinter.enabled": true,
  "pplLinter.openSearchVersion": "3.5",
  // Optional local OpenSearch index-template YAML files, combined with fetched templates
  "pplLinter.indexTemplateGlob": "/path/to/templates/index-template-*.yaml",
  // Optional template names or name patterns; an empty list fetches all templates
  "pplLinter.openSearchTemplateNames": ["mam_*", "security-*"],
  // Optional live index mappings fetched directly from OpenSearch
  "pplLinter.openSearchMappingIndexes": ["mam_*", "lookup_*"],
  // Optional source indexes, aliases, or glob patterns to include
  "pplLinter.includedIndexes": ["auditd-*", "auditd-reader"],

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
    "PPL008": "error",
    "PPL009": "warning",
    "PPL010": "error",
    "PPL011": "error",
    "PPL012": "error",
    "PPL013": "error",
    "PPL014": "error",
    "PPL015": "warning"
  },

  // Debounce delay in milliseconds for typing
  "pplLinter.debounceMs": 350,
  "pplLinter.lintOnType": true
}
```

On first activation, the extension asks for an OpenSearch domain, username, and password, then fetches templates from `/_index_template`. `pplLinter.openSearchTemplateNames` selects template names or name patterns via `/_index_template/{template-name}`; an empty list fetches all templates. Each entry in `pplLinter.openSearchMappingIndexes` triggers a live request to `/{pattern}/_mapping`; for example, `mam_*` fetches mappings for matching indexes. The OpenSearch account needs permission to read the selected templates and mappings. It asks again every seven days. The password is used for requests and is never persisted. The extension caches the domain, username, last prompt time, selected templates, and mapping responses in VS Code extension state so restarts do not trigger extra prompts. Changing either selection list triggers a refresh. Run **PPL: Refresh OpenSearch Index Patterns** to refresh early. Remote connections require HTTPS; HTTP is allowed for localhost.

`pplLinter.indexTemplateGlob` is empty by default and remains optional. Set a workspace-relative glob or an absolute glob for local templates in another repository. The extension watches those files and combines them with the fetched templates for index-pattern and alias matching, field/type checks, hover, and completion. A source that matches no configured template is an error. A field absent from all templates, or only allowed by a `dynamic: true` mapping, is an error when used. Fields from templates sharing an alias are combined; equivalent PPL types merge, while conflicting PPL types are reported at the field reference. The checker follows PPL implicit conversions and warns when string-to-number conversion may fail for runtime values.

Use `pplLinter.openSearchMappingIndexes` to choose which live index mappings the extension fetches. It accepts index names, aliases, and patterns using `*` and `?`; it is empty by default. Use `pplLinter.includedIndexes` separately to restrict source and lookup schema checks, mapped-field hovers, and suggestions to selected names or patterns. An empty `includedIndexes` list includes all sources and lookup indexes; it filters local use of cached schemas, not what the mapping API fetches.

Function signatures and casts infer types through `eval` and named `stats` outputs. Field scope follows `fields`, `table`, `rename`, `stats`, `eventstats`, and `streamstats`. After an unmodeled field-changing stage, hard missing-field checks pause to avoid false positives. Incomplete syntax suppresses dependent semantic errors. Lookup keys and selected output fields are checked against the resolved lookup index schema. When no output fields are listed, all non-key fields from the lookup schema are added. `replace` is the default mode; `append` requires an existing output field.

The OpenSearch type mapping follows the documented PPL types. `keyword`, `text`, and `wildcard` map to `string`; `integer` to `int`; `long` to `bigint`; `date` to `timestamp`; `object` to `struct`; and `nested` to `array`. Unsupported OpenSearch mapping types are treated as untyped rather than guessed.

For embedded YAML, TOML, and JSON queries, schema diagnostics and completions require exact source mapping, just like existing diagnostics. Decoded or folded strings remain unmappable and are skipped.

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
