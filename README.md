# Distributed Wagering Processor

Processa transações de aposta (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) vindas de provedores de jogos por HTTP e por
SQS. Mantém saldo e ledger corretos mesmo com mensagens duplicadas, fora de ordem e concorrentes, e com várias
instâncias rodando ao mesmo tempo.

Decisões e limitações: [ARCHITECTURE.md](./ARCHITECTURE.md).
Histórias de usuário, casos de uso e fluxogramas: [docs/casos-de-uso.md](./docs/casos-de-uso.md).

**Stack:** Bun · TypeScript strict · NestJS · MikroORM · PostgreSQL 17 · SQS via MiniStack · Docker Compose.

> Uso o MiniStack em vez do LocalStack porque a imagem atual do LocalStack não sobe sem `LOCALSTACK_AUTH_TOKEN`.
> O MiniStack implementa a mesma API do SQS, inclusive filas FIFO.

## Rodar

```bash
# tudo no Docker: Postgres, SQS, migrations e 3 réplicas (portas 3000, 3001, 3002)
docker compose --profile app up -d --build
curl localhost:3000/health/ready
```

```bash
# desenvolvimento local (Bun >= 1.4)
bun install
docker compose up -d postgres sqs     # Postgres em localhost:5433, SQS em localhost:4566
bun run migration:up
bun run start                         # http://localhost:3000
```

## Como o código foi construído

Cada commit resolve um subproblema e reaproveita os anteriores:

| Degrau | Problema | Solução |
|---|---|---|
| 1 | saldo correto com uma requisição | `Money` em centavos, `Wallet.credit/debit` devolvem o lançamento, CHECKs no banco |
| 2 | requisição repetida | `Idempotency-Key` + hash do payload, `UNIQUE` no banco |
| 3 | requisições simultâneas | `SELECT ... FOR UPDATE` na wallet |
| 4 | estornos | `REFUND`/`ROLLBACK` com referência, uma reversão por transação |
| 5 | referência fora de ordem | `PENDING_REFERENCE` (202) + worker com backoff |
| 6 | entrada pela fila | consumidor SQS + inbox na mesma transação + DLQ por redrive |
| 7 | avisar outros sistemas | outbox + worker com `SKIP LOCKED` |
| 8 | várias instâncias | compose com 3 réplicas; as garantias já estão no banco |
| 9 | enxergar o sistema | métricas, health, logs JSON, reconciliação |

## Endpoints

| Rota | |
|---|---|
| `POST /wallets` | cria wallet; saldo inicial > 0 gera transação `OPENING` + crédito |
| `GET /wallets/:id` | saldo e versão |
| `GET /wallets/:id/ledger?cursor=&limit=` | lançamentos, mais novo primeiro (`limit` 1..200) |
| `POST /wallets/:id/reconciliation` | saldo gravado vs. ledger |
| `POST /wagering/transactions` | header `Idempotency-Key` obrigatório |
| `GET /wagering/transactions/:id` | por id interno |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | por id do provedor |
| `GET /health/live`, `GET /health/ready`, `GET /metrics` | operação |

Status de `POST /wagering/transactions`: `201` processada · `200` reenvio de processada · `202` esperando a
referência · `422` rejeitada (`failureCode` no corpo) · `400` payload inválido · `404` wallet inexistente ·
`409` mesma chave com payload diferente.

```bash
curl -s -X POST localhost:3000/wallets -H 'content-type: application/json' \
  -d '{"playerId":"player-1","initialBalance":{"amount":"100.00","currency":"BRL"}}'

curl -s -X POST localhost:3000/wagering/transactions -H 'content-type: application/json' \
  -H 'Idempotency-Key: provider-a:tx-1' -d '{
  "providerId":"provider-a","externalTransactionId":"tx-1","playerId":"player-1","walletId":"<WALLET_ID>",
  "roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

Mensagem na fila `wager-transactions.fifo` (`MessageGroupId` = walletId):

```json
{ "messageId": "msg-1", "type": "WagerTransactionRequested", "occurredAt": "2026-11-10T12:00:00Z",
  "data": { "...mesmos campos do HTTP...": "", "idempotencyKey": "provider-a:tx-1" } }
```

## Configuração

| Variável | Padrão |
|---|---|
| `PORT` | `3000` |
| `DATABASE_URL` | `postgres://wagering:wagering@localhost:5433/wagering` |
| `SQS_ENDPOINT` / `AWS_REGION` | `http://localhost:4566` / `us-east-1` |
| `SQS_TRANSACTIONS_QUEUE` / `SQS_DLQ` / `SQS_EVENTS_QUEUE` | `wager-transactions.fifo` / `wager-transactions-dlq.fifo` / `wagering-events.fifo` |
| `SQS_MAX_RECEIVE_COUNT` / `SQS_VISIBILITY_TIMEOUT` / `SQS_WAIT_TIME_SECONDS` | `5` / `30` / `10` |
| `RUN_CONSUMER` / `RUN_WORKERS` | `true` / `true` |
| `RUN_MIGRATIONS` | `false` (o compose usa o serviço `migrate`) |
| `LOG_LEVEL` | `log` |

## Estrutura

```
src/domain/       regras puras: Money, Wallet + LedgerEntry, WagerTransaction, eventos
src/application/  casos de uso (wallets, wagering) e validação de entrada
src/database/     tabelas do MikroORM, mappers, migrations (uma por degrau)
src/http/         controllers, filtro de erro, log de requisição
src/sqs/          cliente SQS e consumidor
src/workers/      outbox e referências pendentes
```
