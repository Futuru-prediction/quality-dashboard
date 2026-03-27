# FTU-220 Validation Report

Escopo: validação manual do MVP do `quality-dashboard` com tokens reais do ambiente local, sem alterar `App.jsx`.

## Resumo

- GitHub PAT: validado com `GET /user` retornando `200`.
- Linear API key: validada com GraphQL `viewer` retornando `200`.
- Dashboard carregou nos três browsers testados.
- Empty state validado em `Testes instáveis`.
- Há regressão de responsividade em 375px com overflow horizontal.
- `desconectar` retorna para a tela inicial, mas não limpa os valores dos campos de token.

## Revalidação Pós-Fix (local, não publicado)

Após os ajustes em `src/App.jsx`, rodei uma revalidação local com Playwright no app servido por `vite`:

- `overflow` em `375px`: `0` (`scrollWidth=375`, `clientWidth=375`) em ambiente local.
- `desconectar` limpa os campos sensíveis: `inputValues=["", ""]` e `allEmpty=true`.

Observação: em produção (`https://quality-dashboard-three.vercel.app/`), o overflow ainda aparece (`scrollWidth=556`, `clientWidth=375`) porque esta versão corrigida ainda não foi deployada.

## Evidências

- Screenshot desktop: [FTU-220-chromium-dashboard.png](/Users/hugogoncalves/PRJ/Ebinex/quality-dashboard/docs/qa/FTU-220-chromium-dashboard.png)
- Screenshot mobile 375px: [FTU-220-mobile-375.png](/Users/hugogoncalves/PRJ/Ebinex/quality-dashboard/docs/qa/FTU-220-mobile-375.png)

## Tabela de Validação

| Item | Status | Evidência | Observações |
|---|---|---|---|
| Tokens reais autenticam GitHub e Linear | PASS | `GET https://api.github.com/user -> 200`; GraphQL `viewer -> 200` | Tokens locais funcionaram sem necessidade de fallback |
| Dashboard principal carrega com dados reais | PASS | Chromium/Firefox/WebKit chegaram ao estado `LIVE` com dados reais | `Repos=4`, `Issues Total=50`, `Em progresso=6` na amostra observada |
| Labels do Linear aparecem na UI | PASS | Snippet do corpo mostrou `PERFORMANCE`, `FRONTEND`, `FEATURE`, `QA` na seção `Features Testadas` | Validação feita com issue labels reais retornadas pela API do Linear |
| Tokens não aparecem em texto visível nem em storage | PASS | `document.body.innerText` não contém `ghp_`/`lin_api_`; `localStorage` e `sessionStorage` vazios | Os valores seguem nos campos `password`, mas sem exposição em texto visível ou storage persistente |
| Empty state de `Testes instáveis` aparece quando não há flaky tests | PASS | `Nenhum teste instável encontrado nos últimos 10 runs de {repo}` em `frontend`, `k6`, `core` e `bff` | O estado vazio foi observado ao alternar os repos ativos |
| `desconectar` limpa a tela de dashboard | PASS | Depois do clique, a UI voltou para a tela inicial | `data` e o estado conectado foram limpos |
| `desconectar` limpa completamente os dados sensíveis da UI | FAIL | Após desconectar, os inputs ainda tinham valores (`40` e `48` chars) | O botão não zera os campos de token, então o dado continua presente no DOM dos inputs |
| Cross-browser: Chromium / Firefox / WebKit | PASS | Execução concluída em todos os três browsers | Mesmo comportamento observado nos três projetos |
| Responsividade em 375px | FAIL | `scrollWidth=556` com `clientWidth=375` | Há overflow horizontal na tela mobile; captura salva em `FTU-220-mobile-375.png` |

## Comandos Executados

- `npm run dev -- --host 127.0.0.1 --port 4173`
- `node --input-type=module` com Playwright para validação em Chromium
- `node --input-type=module` com Playwright para validação em Firefox
- `node --input-type=module` com Playwright para validação em WebKit
- `node --input-type=module` com Playwright para validação em viewport de `375px`
- `node --input-type=module` para checagem direta de `GET /user` na GitHub API e `viewer` na Linear API

## Arquivos Alterados

- `docs/qa/FTU-220-validation.md`
- `docs/qa/FTU-220-chromium-dashboard.png`
- `docs/qa/FTU-220-mobile-375.png`

## Notas

- Os branches de empty state para Bugs/Features/Em Progresso não ficaram vazios no dataset real disponível nesta validação; por isso não forcei alteração de dados ou código para fabricá-los.
- O comportamento de desconexão ainda deixa os tokens preenchidos nos campos de formulário. Se o objetivo de produto for remover também esses valores da UI, isso precisa de ajuste de implementação.
