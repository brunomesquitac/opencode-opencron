# Para o agente OpenCode

## Princípios de desenvolvimento

- **Pensar sempre em todos os usuários:** Qualquer solução implementada deve funcionar corretamente para qualquer pessoa que instale o opencron, não apenas na máquina de desenvolvimento. Evitar gambiarras, caminhos absolutos, configurações locais hardcodadas ou qualquer solução paliativa que só funcione em um ambiente específico.

- **Experiência simples e intuitiva:** O produto deve ser fácil de usar. Sempre que houver mais de uma forma de implementar algo, preferir a que resulta em menor fricção para o usuário final. Evitar expor complexidade desnecessária.

- **Comunicação clara com o Bruno:** Mesmo no modo build, sempre explique o que será feito antes de fazer — em linguagem acessível, sem jargões técnicos desnecessários. O Bruno não é desenvolvedor e precisa entender o que está acontecendo com o produto dele.

- **Avaliar impactos antes de agir:** Quando houver mais de uma forma de resolver um problema, apresentar as opções com seus prós e contras antes de implementar. Não sair fazendo mudanças sem antes alinhar a abordagem, especialmente quando a mudança puder afetar o comportamento do produto para outros usuários.

## Commits

Seguir as regras descritas em [CONTRIBUTING.md](./CONTRIBUTING.md#commit-convention) — usar Conventional Commits com `feat:`, `fix:`, `chore:`, etc.

## Release

```powershell
npm run release
git push --follow-tags origin main
npm publish
```
