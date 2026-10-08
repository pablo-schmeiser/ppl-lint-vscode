---
name: build-extension
description: Builds and packages the VS Code extension into a VSIX file.
---

# Build Extension Skill

## Instructions
1. First, ensure the codebase is clean by running `pnpm compile` and `pnpm lint`.
2. Build the production code by running `pnpm build`.
3. Package the extension by running `pnpm package`.
4. If successful, point the user to the generated `.vsix` file. If there are errors (e.g., missing dependencies or compilation failures), debug and resolve them.
