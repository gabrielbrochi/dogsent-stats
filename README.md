# DOGSENT.gg Stats

Hub de estatísticas de CS2 da matilha DOGSENT: ranking, partidas, perfis e duelo, com partidas da Gamers Club, FACEIT e Premier puxadas do Leetify.

## Como funciona

- `players.json`: lista da galera (apelido + link da Steam).
- `scripts/collect.mjs`: busca o perfil de cada um no Leetify, baixa o detalhe das partidas novas e gera `docs/data/hub.json`. O histórico acumula em `data/matches/`.
- `.github/workflows/collect.yml`: roda o coletor a cada 3 horas e salva os dados no repositório.
- `docs/`: o site (GitHub Pages).

## Adicionar um amigo

Edite `players.json` e acrescente uma linha com o apelido e o link da Steam. O amigo precisa ter conta no Leetify com Gamers Club, FACEIT e Matchmaking conectados.

## Configuração (uma vez)

1. **Settings → Pages**: em "Source", escolha "Deploy from a branch", branch `main`, pasta `/docs`.
2. **Settings → Actions → General**: em "Workflow permissions", marque "Read and write permissions".
3. Opcional: **Settings → Secrets and variables → Actions** → `LEETIFY_API_KEY` com a chave da API pública do Leetify.
4. **Actions → Coletar partidas → Run workflow** para a primeira coleta.

## Testar localmente

```
node scripts/mock-api.mjs &
LEETIFY_BASE_URL=http://localhost:8787 node scripts/collect.mjs
npx serve docs
```

Dados fornecidos pelo Leetify.
