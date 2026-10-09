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
- **Function Documentation**: Recognizes OpenSearch 3.5 date/time aliases, JSON, conversion, cryptographic, mathematical, and relevance functions. Newly researched entries include argument signatures, descriptions, examples, and direct links to their OpenSearch 3.5 documentation. Collection lambdas, JSON argument pairs, relevance field boosts, and named relevance options are parsed and checked. Signature checks require a resolved index schema; passing lint does not verify server execution or plugin/Calcite availability.
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
| **`PPL005`** | `UnknownFunction` | `error` | Flags unknown functions in expressions and aggregations with similarity hints. |
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
    "PPL005": "error",
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

On first activation, the extension uses configured `openSearchUrl` and `openSearchUsername` values, or asks for them when absent, then prompts for the password and fetches templates from `/_index_template`. `pplLinter.openSearchTemplateNames` selects template names or name patterns via `/_index_template/{template-name}`; an empty list fetches all templates. Each entry in `pplLinter.openSearchMappingIndexes` triggers a live request to `/{pattern}/_mapping`; for example, `mam_*` fetches mappings for matching indexes. The OpenSearch account needs permission to read the selected templates and mappings. It asks for the password again every seven days. The password is used for requests and is never persisted. The extension caches the domain, username, last prompt time, selected templates, and mapping responses in VS Code extension state so restarts do not trigger extra prompts. Changing either selection list triggers a refresh. Run **PPL: Refresh OpenSearch Index Patterns** to refresh early. Remote connections require HTTPS; HTTP is allowed for localhost.

### Shared Config File

The CLI and VS Code extension can share a JSONC file named `.ppl-lint.jsonc`. The CLI discovers it in the current directory; use `--config <path>` to choose another file. VS Code loads it from the first workspace folder by default; `pplLinter.configFile` can point to another relative or absolute path. Changes are watched and applied without restarting the extension.

The `pplLinter` object accepts the VS Code lint and extraction settings, plus `openSearchUrl` and `openSearchUsername`. When supplied, the extension uses these values directly and still prompts for the password. The `cli` object holds command-line inputs and output options. Relative paths in the file are resolved from the config file's directory by the CLI.

```jsonc
{
  "version": 1,
  "pplLinter": {
    "enabled": true,
    "openSearchUrl": "https://opensearch.example.com",
    "openSearchUsername": "reader",
    "openSearchVersion": "3.5",
    "indexTemplateGlob": "./templates/index-template-*.yaml",
    "openSearchTemplateNames": ["auditd-*", "syslog-*"],
    "openSearchMappingIndexes": ["mam_*", "users"],
    "includedIndexes": ["auditd-*", "users"],
    "standalone": {
      "fileExtensions": [".ppl", ".pplquery", ".query"],
      "languageIds": ["ppl"]
    },
    "embedded": [{
      "id": "yaml-ppl-queries",
      "filePattern": "**/*.{yaml,yml}",
      "format": "yaml",
      "keyPatterns": ["query", "ppl_query"],
      "heuristicDetection": true
    }],
    "customCommands": [],
    "customFunctions": [],
    "additionalKeyPatterns": [],
    "excludeKeyPatterns": [],
    "overrideDefaultKeyPatterns": false,
    "rules": { "PPL003": "warning" },
    "lintOnType": true,
    "debounceMs": 350
  },
  "cli": {
    "inputs": ["queries/"],
    "queries": [],
    "corpusPaths": [],
    "templatePaths": [],
    "stdinFormat": "ppl",
    "outputFormat": "text",
    "saveOpenSearchCache": "./opensearch-cache"
  }
}
```

---

## Command-Line Interface

### Quick Start

Requires Node.js 18 or newer. Pack the CLI and install it globally into your user environment, or run it directly from this checkout:

#### Global Install with pnpm (Recommended)

Since this project uses `pnpm`, install globally into your user bin without requiring `sudo` or elevated permissions:

```bash
pnpm pack
pnpm add --global ./ppl-lint-vscode-0.1.0.tgz
ppl-lint --help
ppl-lint queries/ alerts/
```

#### Global Install with npm

On Linux/macOS, default `npm install --global` may attempt to write to `/usr/lib/node_modules` and fail with `EACCES (permission denied)`. To install without sudo, target a user directory or use a user-configured prefix:

```bash
# User-level installation on Linux (avoids EACCES / sudo issues):
npm install --global --prefix ~/.local ./ppl-lint-vscode-0.1.0.tgz

# Or if your npm global prefix is configured for your user (~/.npm-global):
npm install --global ./ppl-lint-vscode-0.1.0.tgz
```

#### Run Directly Without Global Install

You can also run the CLI directly from this checkout:

```bash
pnpm build
pnpm cli --help
# Or invoke the executable directly:
./dist/cli.js --help
```

Directories are scanned recursively for PPL, YAML, TOML, and JSON files. The CLI uses `.ppl-lint.jsonc` when present and otherwise uses built-in defaults; use `--corpus` for probe-result JSON with nested `results[].query` records.

### Options

| Parameter | Description | Default |
| --- | --- | --- |
| `--config <path>` | Load shared JSONC configuration. | `.ppl-lint.jsonc` in the current directory |
| `file-or-directory ...` | Input paths. Scans `.ppl`, `.pplquery`, `.query`, `.yaml`, `.yml`, `.toml`, and `.json`; skips `.git`, `node_modules`, `dist`, `out`, and `coverage`. | None |
| `--query <text>` | Lint a PPL query directly. Repeatable. | None |
| `--corpus <path>` | Lint `results[].query` from a corpus JSON file or a directory of corpus files. Diagnostics include record IDs and families; `mismatches` entries are not processed twice. | None |
| `-` | Read one input from stdin. Piped stdin is read automatically when no other input is given. | PPL input |
| `--stdin-format <format>` | Stdin format: `ppl`, `yaml`, `toml`, or `json`. | `ppl` |
| `--template <path>` | Local YAML/JSON index-template file or directory. Repeatable. | None |
| `--opensearch-url <url>` or `PPL_OPENSEARCH_URL` | OpenSearch URL. Remote URLs must use HTTPS; HTTP is allowed for localhost. | None |
| `--opensearch-username <name>` or `PPL_OPENSEARCH_USERNAME` | Basic-auth username. | None |
| `PPL_OPENSEARCH_PASSWORD` | Basic-auth password. Set in the environment; it is not accepted as a CLI argument or saved by the CLI. | None |
| `--opensearch-template <pattern>` | Remote index-template name or wildcard. Repeatable. | All templates |
| `--mapping-index <pattern>` | Fetch live mappings for an index or wildcard. Repeatable. | None |
| `--save-opensearch-cache <directory>` | Save fetched templates and mappings as a reusable JSON cache. With no query or file input, runs fetch-only. | None |
| `--opensearch-version <version>` | OpenSearch version to lint against. | `3.5` |
| `--include-index <pattern>` | Limit schema checks to matching source indexes. Repeatable. | All indexes |
| `--custom-command <name>` | Add a recognized PPL command. Repeatable. | None |
| `--custom-function <name>` | Add a recognized PPL function. Repeatable. | None |
| `--format <value>` | Diagnostic output format: `text` or `json`. | `text` |
| `-h`, `--help` | Show CLI help. | N/A |

### Examples

```bash
# Lint files and directories
ppl-lint queries/ alerts/

# Lint a query or piped YAML
ppl-lint --query 'source=logs | where status >= 500'
cat alert.yaml | ppl-lint --stdin-format yaml

# Lint the checked-in probe corpus or use local templates
ppl-lint --corpus test/fixtures/ppl-corpus-probe-results.json --format json
ppl-lint --template ./opensearch-templates/ queries/
```

For OpenSearch, set the URL and username, then enter the password at the hidden prompt:

```bash
export PPL_OPENSEARCH_URL='https://opensearch.example.com'
export PPL_OPENSEARCH_USERNAME='reader'
export PPL_OPENSEARCH_PASSWORD='<token>'
ppl-lint --opensearch-template 'logs-*' --mapping-index 'logs-*' \
  --save-opensearch-cache ./opensearch-cache
ppl-lint --template ./opensearch-cache queries/
unset PPL_OPENSEARCH_PASSWORD
```

The cache is stored as `ppl-lint-opensearch-cache.json` inside the selected directory. It contains the fetched template response and each mapping response with its selector; pass that directory to `--template` to lint offline. Omitting query and file inputs from the save command makes it a fetch-only preparation step.

Text output prints one line per diagnostic and a summary, including on clean runs. JSON output is only an array of diagnostics; `[]` means no findings, and locations are 1-based. Corpus mode lints locally; it does not call OpenSearch or compare stored verdicts. Exit status: `0` means no errors, `1` means lint errors, and `2` means invalid CLI input or an input/OpenSearch failure.

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
