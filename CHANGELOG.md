<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to the "ppl-lint-vscode" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Extend PPL parsing and validation for OpenSearch 3.5 commands and functions, including command-argument checks, type checks for expressions, casts, operators, and function arguments, and syntax highlighting for new syntax.
- Load local or live OpenSearch index templates and mappings for schema-aware field resolution, completion, and type checking. New `PPL011`-`PPL015` diagnostics report unresolved sources, unknown or untyped fields, conflicting field types, type mismatches, and risky implicit conversions.
- Add `PPL008` for recognized command stages whose arguments are not yet covered by validation.
- Add context-aware completion for commands, functions, sources, fields, and `join`/`lookup` syntax.
- Add hover documentation for PPL commands and schema-backed fields, including inferred types for computed fields.
- Add `pnpm run test:thorough` to run the dependency audit, typecheck, lint, tests, and production build.
- Added a CLI

### Changed

- **Breaking:** Invalid OpenSearch versions and versions below 3.5 now produce `PPL010` and stop linting. Versions newer than 3.5 use the 3.5 validation baseline and produce a `PPL009` warning.

### Removed

- **Breaking:** Remove `PPL007` and its quick-fix. Both `=` and `==` are accepted as equality operators in conditions; remove any `pplLinter.rules.PPL007` override.

## [0.1.0] - 2026-09-11

### Added

- **Core PPL Lexer and Resilient Parser**:
  - Full support for PPL pipeline syntax (`source`, `search`, `where`, `stats`, `eval`, `dedup`, `sort`, `rename`, `fields`, `head`, `top`, `rare`, `grok`).
  - Precise line, column, and character offset tracking across all tokens and AST nodes.
  - Pipe-level error recovery to prevent syntax error cascading.
- **Diagnostic Rules Catalog (PPL001 - PPL007)**:
  - `PPL001`: Syntax error reporting with recovery context.
  - `PPL002`: Missing source detection with auto-prepend quick-fix.
  - `PPL003`: Unknown command detection with Levenshtein-based quick-fix recommendations.
  - `PPL004`: Invalid arguments validation for standard pipe commands.
  - `PPL005`: Unknown function detection for aggregations and scalar expressions.
  - `PPL006`: Late filter warning when `where` is positioned after `sort`, `stats`, or `dedup`.
  - `PPL007`: Assignment operator `=` detection in boolean conditions with `==` quick-fix.
- **Embedded Subkey Structured Extractors**:
  - YAML CST extractor with line-accurate source-mapping for block scalars (`|`, `|-`, `|+`), folded scalars, and indentation offsets.
  - TOML extractor with table and multiline string span preservation.
  - JSON AST extractor using `jsonc-parser`.
  - Flexible wildcard key pattern matching and heuristic detection (`source=`, `search=`).
- **VS Code Extension Integration**:
  - Debounced background diagnostic engine with user-configurable timeout.
  - Interactive Quick-Fix (CodeAction) provider.
  - Command hover documentation with syntax templates and OpenSearch doc links.
  - TextMate syntax highlighting grammar for `.ppl` files.
  - Status bar item displaying real-time lint status and issue counts.
