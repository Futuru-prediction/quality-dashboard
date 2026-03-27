# Quality Dashboard - Visual QA Checklist

Objetivo: executar uma validação visual mínima em menos de 10 minutos antes de merge/release.

## Pré-requisitos

- Dependências instaladas: `npm ci`
- Ambiente local disponível em `http://127.0.0.1:4173`

## Fluxo rápido (<= 10 minutos)

1. Suba o app local:
   - `npm run build`
   - `npm run preview -- --host 127.0.0.1 --port 4173`
2. Execute o smoke E2E:
   - `npm run test:e2e`
3. Gere capturas dos três breakpoints:
   - `npx playwright screenshot --device="Desktop Chrome" http://127.0.0.1:4173 output/qa-desktop-1440.png`
   - `npx playwright screenshot --viewport-size=768,1024 http://127.0.0.1:4173 output/qa-tablet-768.png`
   - `npx playwright screenshot --viewport-size=375,812 http://127.0.0.1:4173 output/qa-mobile-375.png`

## Checklist por breakpoint

### Desktop (>= 1280px)

- [ ] Header visível e sem quebra de layout.
- [ ] Cards de estatística em uma grade legível (sem sobreposição).
- [ ] Tabelas/listas com conteúdo truncado corretamente (sem texto vazando).

### Tablet (768px)

- [ ] Grids alternam para layout intermediário sem colapsar conteúdo.
- [ ] Botões/filtros continuam clicáveis e sem clipping.
- [ ] Cards principais mantêm espaçamento uniforme.

### Mobile (375px)

- [ ] Sem overflow horizontal (`scrollWidth` igual ao `clientWidth`).
- [ ] Tela de conexão mantém título + campos + botão totalmente visíveis.
- [ ] Seções em cards empilhadas verticalmente sem cortar texto.
- [ ] Textos auxiliares (`muted`) legíveis em ambiente escuro.
- [ ] Botão `desconectar` com contraste suficiente para ação rápida.
- [ ] Navegação por teclado mostra foco visível em botões/links/inputs críticos.

## Evidências mínimas

- `output/qa-desktop-1440.png`
- `output/qa-tablet-768.png`
- `output/qa-mobile-375.png`
- Resultado do comando `npm run test:e2e` (pass/fail)

## Regra de decisão (merge/release)

- Bloquear merge/release se algum item de mobile falhar.
- Bloquear merge/release se `npm run test:e2e` falhar.
- Permitir merge/release se todos os itens obrigatórios passarem e as 3 capturas existirem.
