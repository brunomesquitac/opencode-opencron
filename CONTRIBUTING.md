# Contributing

## Commit Convention

This project uses **Conventional Commits** to auto-generate the `CHANGELOG.md` and bump versions.

Every commit message must follow:

```
<type>: <description>
```

### Types

| Type     | Usage                    | Version bump |
|----------|--------------------------|--------------|
| `feat`   | New feature              | minor        |
| `fix`    | Bug fix                  | patch        |
| `docs`   | Documentation only       | patch        |
| `refactor` | Code refactoring       | patch        |
| `chore`  | Maintenance, deps        | patch        |
| `style`  | Formatting, linting      | patch        |
| `test`   | Adding or fixing tests   | patch        |
| `perf`   | Performance improvement  | patch        |
| `revert` | Revert a previous commit | patch        |

### Examples

```
feat: add webhook notification support
fix: scheduler crash on DST change
docs: update installation instructions
chore: bump dependencies
```

### Breaking changes

Add `!` after the type or `BREAKING CHANGE:` in the footer:

```
feat!: drop Node 18 support
```

## Release workflow

```powershell
# 1. Make changes and commit
git add .
git commit -m "feat: add webhook support"
git commit -m "fix: dashboard crash on empty list"

# 2. Generate changelog + bump version + create tag
npm run release

# 3. Push everything
git push --follow-tags origin main

# 4. Publish to npm
npm publish
```

## First release

```powershell
npm run release -- --first-release
```
