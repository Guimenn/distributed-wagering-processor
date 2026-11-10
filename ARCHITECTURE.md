# Arquitetura

**Ideia central:** as regras de dinheiro ficam no Postgres. Um bug ou duas instâncias ao mesmo tempo viram erro,
nunca saldo errado.

## Camadas

```
http/, sqs/     recebem e validam
application/    abrem a transação SQL e gravam
domain/         regras puras (Money, Wallet, WagerTransaction)
database/       tabelas, mappers, migrations
workers/        publicam eventos e reprocessam pendentes
```

## Fluxo

```
HTTP ou SQS → valida → BEGIN
  trava a wallet (FOR UPDATE)
  já existe? devolve o resultado original
  aplica a regra; grava transação, ledger, saldo, outbox
COMMIT → responde (ou ack na fila)
```

## Decisões

- **Centavos em `bigint`**: sem erro de float.
- **Lock por wallet (`FOR UPDATE`)**: o saldo nunca é lido por duas transações ao mesmo tempo; wallets diferentes rodam em paralelo.
- **Idempotência no banco (`UNIQUE`)**: reenvio devolve o mesmo resultado, nunca debita duas vezes.
- **Rejeição é resultado (422)**, gravado para auditoria.
- **Referência fora de ordem espera (202)** e é tentada de novo; depois de ~17 min, rejeita.
- **Inbox + ack depois do COMMIT**: mensagem repetida não duplica.
- **DLQ pela própria fila** depois de 5 tentativas.
- **Outbox**: evento gravado junto com o saldo, publicado depois.

## Limitações

- Mensagem inválida é lida 5 vezes antes de ir para a DLQ.
- Sem autenticação dos provedores.
