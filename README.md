# ◈ Futuru QA Dashboard

Painel centralizado de saúde de qualidade dos repositórios do ecossistema Futuru. Dados reais do GitHub Actions e Linear, zero backend, zero custo.

![Dashboard](https://img.shields.io/badge/status-live-00e5a0?style=flat-square) ![Stack](https://img.shields.io/badge/stack-React%20%2B%20Vite-4a9eff?style=flat-square) ![License](https://img.shields.io/badge/license-internal-gray?style=flat-square)

---

## O que monitora

| Seção | Fonte | Dados |
|---|---|---|
| Stats gerais | GitHub + Linear | Repos, issues, bugs abertos, runs passou/falhou |
| Pipeline Status | GitHub Actions | Status por repo, taxa de sucesso, runs recentes |
| Último Deploy / Commits | GitHub | Último commit por repo, autor, data |
| Test Runs | GitHub Actions | Execuções com status, duração, branch |
| Bugs | Linear (label: Bug) | Prioridade, assignee, estado, link |
| Features Testadas | Linear (label: Feature/Feat) | Labels, estado, link |
| Em Progresso | Linear (state: started) | Cards com prioridade e responsável |

**Repositórios monitorados:**
- `Futuru-prediction/futuru-frontend`
- `Futuru-prediction/futuru-k6`
- `Futuru-prediction/futuru-core`
- `Futuru-prediction/futuru-bff`

---

## Rodando localmente

### 1. Pré-requisitos

- Node.js 18+
- npm 9+

### 2. Instalar

```bash
git clone https://github.com/Futuru-prediction/quality-dashboard.git
cd quality-dashboard
npm install
```

### 3. Variáveis de ambiente

```bash
cp .env.example .env
```

Edita o `.env` com seus tokens:

```env
VITE_GITHUB_TOKEN=ghp_...
VITE_LINEAR_TOKEN=lin_api_...
```

> **Nunca commite o `.env`** — ele já está no `.gitignore`.

### 4. Rodar

```bash
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173), insere os tokens nos inputs e clica **Conectar**.

---

## Testes e qualidade

### Unitários + contratos

```bash
npm run test
```

Esse comando executa:

- `src/lib/*.test.js` (parsers, métricas, flakiness e bridge helpers)
- `api/*.test.js` (contratos do endpoint `POST /api/sentry-whatsapp-webhook`)

### Lint

```bash
npm run lint
```

### E2E (Playwright)

```bash
npm run test:e2e
```

Por padrão, o Playwright sobe `build + preview` local e testa a própria branch em `http://127.0.0.1:4173`.

Se precisar validar contra um ambiente remoto específico, sobrescreva:

```bash
PLAYWRIGHT_BASE_URL=https://seu-ambiente.vercel.app npm run test:e2e
```

---

## Como gerar os tokens

### GitHub Personal Access Token

1. Acessa [github.com/settings/tokens/new](https://github.com/settings/tokens/new)
2. Nome: `futuru-qa-dashboard`
3. Scopes: marcar apenas **`repo`** (leitura de repos privados)
4. Expiration: 90 days
5. Clica **Generate token** — copia o valor (começa com `ghp_`)

> Rate limit com PAT: **5.000 req/hora** — suficiente para uso normal.

### Linear API Key

1. Acessa [linear.app/ebinex/settings/api](https://linear.app/ebinex/settings/api)
2. Em **Personal API Keys**, clica **Create key**
3. Nome: `qa-dashboard`
4. Copia o valor (começa com `lin_api_`)

---

## Deploy no Vercel (URL pública para o time)

### 1. Build local (valida antes de fazer deploy)

```bash
npm run build
```

### 2. Criar repositório e fazer push

```bash
git init
git remote add origin https://github.com/Futuru-prediction/quality-dashboard.git
git add .
git commit -m "feat: futuru qa dashboard v1"
git push -u origin main
```

### 3. Conectar ao Vercel

1. Acessa [vercel.com](https://vercel.com) e loga com GitHub
2. Clica **Add New Project → Import Git Repository**
3. Seleciona `Futuru-prediction/quality-dashboard`
4. Em **Environment Variables**, adiciona:
   - `VITE_GITHUB_TOKEN` → seu token do GitHub
   - `VITE_LINEAR_TOKEN` → seu token do Linear
5. Clica **Deploy**

Deploy automático acontece a cada push na `main`.

### CI/CD com Sentry

O workflow de deploy em `.github/workflows/deploy.yml` agora:

- cria uma release do Sentry por build/deploy usando o commit SHA (`github.sha`)
- gera sourcemaps no build do Vite
- faz upload dos sourcemaps do artefato de build antes do deploy na Vercel
- falha com mensagem clara se qualquer segredo do Sentry estiver ausente

Secrets obrigatórios no GitHub Actions:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Secrets obrigatórios da Vercel continuam os mesmos:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

### CI de E2E para PRs

O workflow `.github/workflows/e2e.yml` roda em `push`, `pull_request` e `workflow_dispatch`:

- instala dependências e browser (`chromium`)
- executa Playwright contra preview local da branch em teste
- publica artifacts HTML e JSON do report
- atua como quality gate de PR (falha de teste quebra o check)

Runbook operacional de alertas, ownership e roteamento de notificações (WhatsApp via webhook): [docs/operations/sentry-alerting.md](docs/operations/sentry-alerting.md)

Bridge endpoint implementado para Sentry -> WhatsApp (Z-API):

- `POST /api/sentry-whatsapp-webhook`
- Arquivo: `api/sentry-whatsapp-webhook.js`

---

## Estrutura do projeto

```
quality-dashboard/
├── api/
│   ├── sentry-whatsapp-webhook.js
│   └── sentry-whatsapp-webhook.test.js
├── e2e/
│   ├── playwright.config.ts
│   └── tests/
├── docs/
│   ├── operations/
│   └── qa/
├── src/
│   ├── App.jsx
│   ├── components/
│   ├── lib/
│   └── sentry.js
├── .github/workflows/
│   ├── deploy.yml
│   └── e2e.yml
├── .env.example
├── index.html
├── package.json
├── README.md
├── vercel.json
└── vite.config.js
```

---

## Adicionando novos repos ao monitoramento

Edita o array `REPOS` no topo do `src/App.jsx`:

```js
const REPOS = [
  "futuru-frontend",
  "futuru-k6",
  "futuru-core",
  "futuru-bff",
  "novo-repo-aqui",   // adiciona aqui
];
```

O org (`Futuru-prediction`) é configurado na constante `ORG` logo abaixo.

---

## Segurança

- Tokens armazenados **apenas em memória** (`useState`) — nunca em `localStorage`, `sessionStorage` ou cookies
- Nenhum token trafega para servidor próprio — chamadas diretas do browser para GitHub e Linear
- Para deploy com URL pública: tokens ficam em variáveis de ambiente do Vercel (nunca no código fonte)

---

## Roadmap

| Fase | Entrega | Status |
|---|---|---|
| 1 — MVP | Dashboard com GitHub + Linear | ✅ Done |
| 2 — Deploy + Observabilidade | URL pública + Sentry + bridge WhatsApp | ✅ Done |
| 3 — Qualidade de CI | E2E por PR (preview local) + contratos do webhook | 🔄 Em andamento |
| 4 — Higiene de docs | README/runbooks sincronizados | 🔄 Em andamento |

Issues do ciclo atual:

- `FTU-384` — CI E2E por PR com quality gate
- `FTU-385` — cobertura de contratos do webhook
- `FTU-386` — sincronização de README e runbooks

---

## Time

| Papel | Pessoa |
|---|---|
| QA Engineering Lead | Hugo Gonçalves |

---

*Futuru · Ebinex · QA Engineering · 2026*
