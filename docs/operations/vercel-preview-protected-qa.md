# QA automatizado em previews protegidos por Vercel Auth

Objetivo: permitir validação automatizada (Playwright/bots) sem expor o preview publicamente.

## Política

- Manter `Deployment Protection` habilitado nos previews.
- Usar acesso temporário controlado para QA automatizado:
  - opção A: bypass secret dedicado de QA (preferencial para CI)
  - opção B: share URL temporária para investigação manual pontual
- Nunca embutir bypass secret no código-fonte.
- Rotacionar segredo de bypass em cadência definida pelo time (ex.: mensal ou após incidente).

## Fluxo recomendado (CI/local automatizado)

1. Configurar segredo de bypass no projeto Vercel (ex.: `VERCEL_AUTOMATION_BYPASS_SECRET`).
2. Armazenar o valor apenas em secret manager (GitHub Actions Secrets / Vercel env).
3. Executar testes com header/cookie de bypass no runner.
4. Registrar no log do job:
   - URL validada
   - run id
   - ator responsável
5. Em falha, publicar artefatos (screenshots + report) para auditoria.

## Fluxo alternativo (investigação manual rápida)

1. Gerar URL temporária com `_vercel_share`.
2. Validar comportamento no navegador.
3. Encerrar investigação e descartar a URL após uso.

## Checklist de segurança

- [ ] Sem segredo em `.env.example`, README público ou código.
- [ ] Secrets em escopo mínimo necessário.
- [ ] Evidência de execução do QA anexada na pipeline.
- [ ] Rotação de segredo registrada após mudança.

