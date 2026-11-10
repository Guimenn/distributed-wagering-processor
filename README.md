# Distributed Wagering Processor

Processa transações de aposta (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) vindas de provedores de jogos por HTTP e por
SQS. Mantém saldo e ledger corretos mesmo com mensagens duplicadas, fora de ordem e concorrentes, e com várias
instâncias rodando ao mesmo tempo.

Decisões e limitações: [ARCHITECTURE.md](./ARCHITECTURE.md).

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

## Histórias de usuário, casos de uso e fluxogramas

### Atores

| Ator | Quem é |
|---|---|
| **Provedor** | sistema do jogo que envia apostas e resultados (por HTTP ou fila SQS) |
| **Operador** | pessoa de suporte/financeiro que consulta e confere saldos |
| **Sistemas internos** | serviços que recebem os eventos publicados (CRM, antifraude, BI) |

```mermaid
flowchart LR
  P([Provedor]) --> UC1[Criar wallet]
  P --> UC2[Enviar transação]
  P --> UC3[Estornar transação]
  P --> UC4[Consultar transação]
  O([Operador]) --> UC5[Consultar saldo e ledger]
  O --> UC6[Reconciliar wallet]
  O --> UC7[Monitorar o serviço]
  S([Sistemas internos]) --> UC8[Receber eventos]
```


### Histórias de usuário

**HU01: Criar wallet**
Como provedor, quero criar uma wallet com saldo inicial para que o jogador possa apostar.
- Saldo inicial maior que 0 gera um crédito no ledger.
- Mesmo jogador e mesma moeda duas vezes retorna 409.

**HU02: Apostar**
Como provedor, quero debitar uma aposta (BET) para registrar a jogada.
- Com saldo, debita e responde 201.
- Sem saldo, responde 422 `INSUFFICIENT_FUNDS` e o saldo não muda.

**HU03: Pagar prêmio**
Como provedor, quero creditar um prêmio (WIN) ou registrar uma derrota (LOSS).
- WIN credita.
- LOSS só registra o resultado e não mexe no saldo.

**HU04: Reenviar sem duplicar**
Como provedor, quero reenviar uma transação depois de um timeout sem medo de cobrar duas vezes.
- Mesma `Idempotency-Key` com o mesmo payload devolve o resultado original.
- Mesma chave com payload diferente retorna 409.

**HU05: Estornar**
Como provedor, quero devolver (REFUND) ou desfazer (ROLLBACK) uma transação anterior.
- Só reverte transação processada, da mesma wallet e com o mesmo valor.
- Cada transação pode ser revertida uma vez só.

**HU06: Estorno fora de ordem**
Como provedor, quero que um estorno que chegou antes da aposta seja processado quando a aposta chegar.
- O estorno responde 202 e fica aguardando.
- Se a aposta não chegar em ~17 min, o estorno é rejeitado com `REFERENCE_NOT_FOUND`.

**HU07: Enviar pela fila**
Como provedor, quero enviar transações pela fila SQS com as mesmas regras do HTTP.
- Mensagem repetida não duplica.
- Mensagem inválida vai para a DLQ depois de 5 tentativas.

**HU08: Consultar**
Como provedor ou operador, quero consultar uma transação, o saldo e o histórico (ledger).

**HU09: Reconciliar**
Como operador, quero conferir se o saldo bate com a soma do ledger.
- Divergência gera log de erro e métrica. Nada é corrigido automaticamente.

**HU10: Receber eventos**
Como sistema interno, quero ser avisado de cada transação processada, rejeitada ou pendente e de cada mudança de saldo.

**HU11: Monitorar**
Como operador, quero saber se o serviço está de pé e acompanhar volume, latência e erros.


### Casos de uso

#### UC01: Criar wallet
- **Ator:** Provedor
- **Fluxo principal:**
  1. O provedor envia `POST /wallets` com o jogador e o saldo inicial.
  2. O sistema valida os dados.
  3. O sistema cria a wallet (versão 1) e, se o saldo for maior que 0, a transação `OPENING` com o crédito no ledger.
  4. O sistema responde 201 com a wallet.
- **Alternativos:** dados inválidos → 400; wallet já existe → 409.

#### UC02: Enviar transação (BET, WIN, LOSS)
- **Ator:** Provedor
- **Pré-condição:** a wallet existe.
- **Fluxo principal:**
  1. O provedor envia `POST /wagering/transactions` com a `Idempotency-Key`.
  2. O sistema valida e trava a wallet.
  3. O sistema verifica se a transação já existe.
  4. O sistema aplica a regra, grava a transação, o lançamento, o novo saldo e os eventos.
  5. O sistema responde 201.
- **Alternativos:**
  - Sem saldo → 422.
  - Reenvio → 200 com o resultado original.
  - Payload diferente com a mesma chave → 409.
  - Wallet inexistente → 404.
  - Dados inválidos → 400.

#### UC03: Estornar transação (REFUND, ROLLBACK)
- **Ator:** Provedor
- **Fluxo principal:**
  1. O provedor envia a transação com `referenceExternalTransactionId`.
  2. O sistema encontra a transação original.
  3. O sistema valida tipo, wallet, valor e se ela ainda não foi revertida.
  4. O sistema credita (REFUND, ou ROLLBACK de BET) ou debita (ROLLBACK de WIN).
  5. O sistema responde 201.
- **Alternativos:**
  - Original ainda não chegou → 202 (UC09).
  - Já revertida, valor diferente ou tipo inválido → 422.

#### UC04: Consultar transação
- **Ator:** Provedor
- **Fluxo:** `GET /wagering/transactions/:id` ou `GET /providers/:providerId/wagering/transactions/:externalId`.
- **Alternativo:** a transação não existe → 404.

#### UC05: Consultar saldo e ledger
- **Ator:** Operador
- **Fluxo:** `GET /wallets/:id` e `GET /wallets/:id/ledger?limit=&cursor=` (paginado, mais novo primeiro).

#### UC06: Reconciliar wallet
- **Ator:** Operador
- **Fluxo principal:**
  1. O operador envia `POST /wallets/:id/reconciliation`.
  2. O sistema trava a wallet e soma o ledger.
  3. O sistema compara a soma com o saldo gravado.
  4. O sistema responde `consistent: true` ou `false`.
- **Alternativo:** divergência → log de erro e métrica `reconciliation_mismatches_total`.

#### UC07: Processar mensagem da fila
- **Ator:** Provedor (via SQS)
- **Fluxo principal:**
  1. O consumidor recebe a mensagem.
  2. O consumidor executa o UC02 ou o UC03, registrando a inbox na mesma transação.
  3. O consumidor confirma a mensagem (ack).
- **Alternativos:**
  - Mensagem já processada → ack sem efeito.
  - Erro técnico ou mensagem inválida → sem ack, nova tentativa; depois de 5 tentativas, DLQ.

#### UC08: Publicar eventos
- **Ator:** Sistemas internos (recebem)
- **Fluxo principal:**
  1. A cada segundo, o worker pega os eventos pendentes da outbox.
  2. O worker publica na fila de eventos.
  3. O worker marca os eventos como publicados.
- **Alternativo:** falha no envio → tenta de novo no próximo ciclo.

#### UC09: Reprocessar estorno pendente
- **Ator:** Sistema (worker)
- **Fluxo principal:**
  1. A cada segundo, o worker busca os estornos com tentativa vencida.
  2. O worker trava a wallet e aplica o UC03 de novo.
- **Alternativos:**
  - Original ainda ausente → agenda nova tentativa em 2ⁿ segundos.
  - Depois de 10 tentativas → REJECTED `REFERENCE_NOT_FOUND`.


### Fluxogramas

#### Envio de transação (HTTP ou fila)

```mermaid
flowchart TD
  A[Recebe transação] --> B{Payload válido?}
  B -- não --> E400[400 VALIDATION_ERROR]
  B -- sim --> C[BEGIN + trava a wallet]
  C --> D{Wallet existe?}
  D -- não --> E404[404 WALLET_NOT_FOUND]
  D -- sim --> F{Já existe?<br/>chave, id do provedor ou messageId}
  F -- sim, mesmo payload --> R[Devolve resultado original<br/>200 ou 422]
  F -- sim, payload diferente --> E409[409 IDEMPOTENCY_CONFLICT]
  F -- não --> G{É estorno?}
  G -- sim --> H{Original existe?}
  H -- não --> P[PENDING_REFERENCE<br/>202]
  H -- sim --> I{Original válida?<br/>tipo, wallet, valor, não revertida}
  I -- não --> REJ[REJECTED 422]
  G -- não --> J{Débito com saldo?}
  I -- sim --> J
  J -- não --> REJ
  J -- sim --> K[Atualiza saldo + ledger]
  K --> OK[PROCESSED 201]
  OK --> W[Grava transação + eventos na outbox<br/>COMMIT]
  REJ --> W
  P --> W
```

#### Consumidor SQS

```mermaid
flowchart TD
  A[Recebe mensagem] --> B[Executa o envio de transação]
  B --> C{Resultado}
  C -- processada / rejeitada / pendente / 404 / 409 --> D[Ack: apaga da fila]
  C -- inválida ou erro técnico --> E[Sem ack]
  E --> F{Já tentou 5 vezes?}
  F -- não --> G[Volta para a fila após o visibility timeout]
  G --> A
  F -- sim --> H[SQS move para a DLQ]
```

#### Estorno pendente

```mermaid
flowchart TD
  A[Worker a cada 1s] --> B[Busca estornos com tentativa vencida]
  B --> C[Trava a wallet]
  C --> D{Original chegou?}
  D -- sim --> E[Aplica o estorno<br/>PROCESSED ou REJECTED]
  D -- não --> F{10 tentativas?}
  F -- não --> G[Agenda nova tentativa em 2ⁿ s]
  F -- sim --> H[REJECTED<br/>REFERENCE_NOT_FOUND]
```

#### Outbox

```mermaid
flowchart LR
  A[Transação SQL:<br/>saldo + evento na outbox] --> B[(outbox_messages)]
  B --> C[Worker a cada 1s<br/>FOR UPDATE SKIP LOCKED]
  C --> D[Publica na fila de eventos]
  D --> E[Marca published_at]
  E --> F([Sistemas internos])
```
