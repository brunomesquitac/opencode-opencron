# Para o agente OpenCode

## Commits

Seguir as regras descritas em [CONTRIBUTING.md](./CONTRIBUTING.md#commit-convention) — usar Conventional Commits com `feat:`, `fix:`, `chore:`, etc.

## Release

```powershell
npm run release
git push --follow-tags origin main
npm publish
```
