---
trigger: always_on
---

# Commit Message Style

When proposing or generating commit messages for this project, you must use the **Conventional Commits** specification.

Format:
`<type>[optional scope]: <description>`

[optional body]

[optional footer(s)]

**Allowed Types**:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to CI configuration files and scripts
- `agents`: Changes to agent rules or skills
- `chore`: Other changes that don't modify src or test files

Breaking changes must have a `!` before the `:` and after the optional scope, as well as a `BREAKING CHANGE: <description of breaking changes>` footer.
