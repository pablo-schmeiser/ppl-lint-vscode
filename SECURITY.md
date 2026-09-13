# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

The maintainers of `ppl-lint-vscode` take the security of our software seriously. If you discover a vulnerability or security issue, please follow these steps:

1. **Do not disclose the issue publicly.** Please refrain from opening public GitHub issues or discussions regarding potential security vulnerabilities.
2. **Report via GitHub Security Advisory**: Use the [Private Security Advisory](https://github.com/pablo-schmeiser/ppl-lint-vscode/security/advisories/new) feature on GitHub.
3. **Alternative Contact**: If you cannot use GitHub Security Advisories, contact the maintainer directly at [security@pablo-schmeiser.de](mailto:security@pablo-schmeiser.de) with:
   - A detailed description of the issue.
   - Steps to reproduce or proof-of-concept repository.
   - Expected impact and affected configurations.

We will acknowledge receipt within 96 hours and work with you to patch and release a fix before public disclosure.
We will credit your contribution in the release notes and in the release or security advisory (if you wish, you may remain anonymous).

## Security Considerations

- **Workspace File Safety**: This extension parses user files (YAML, TOML, JSON, and PPL) purely in memory using AST visitors. It executes **zero external shell commands** or dynamic code evaluations (`eval`, `Function`).
- **Dependency Hygiene**: All runtime dependencies are audited via automated weekly Dependabot checks.
