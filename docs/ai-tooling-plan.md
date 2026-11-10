# Lista de Agentes

## 1. Núcleo (preciso deles já)

| Agente | O que faz | Permissão |
|---|---|---|
| **api-architect** | Desenha módulos, fronteiras e fluxos antes do código (máquinas de estado, novos domínios). Aponta trade-offs. | Leitura |
| **nest-feature-builder** | Constrói um módulo completo (module, controller, service, DTOs, testes), seguindo as convenções do projeto. | Escrita |
| **dto-contract-guardian** | Audita DTOs e o contrato OpenAPI. Identifica vazamento de entities, campos sensíveis (comissão visível apenas para o avaliador), falta de `@Type` e `@ApiProperty`, além de `@ApiResponse` ausentes. | Leitura |
| **security-reviewer** | Procura vulnerabilidades de IDOR/ownership, rotas sem guard, uso incorreto de JWT, segredos expostos, ausência de rate limit e exposição excessiva de dados pessoais nas respostas. | Leitura |
| **prisma-db-specialist** | Cuida do schema, migrations, índices, transações, concorrência e consultas lentas. Confere se o client foi regenerado. | Escrita |
| **test-engineer** | Escreve e mantém testes: matriz da máquina de estados, services com mocks, E2E com banco de dados, concorrência, tempo e invariantes financeiros. | Escrita |
| **pr-reviewer** | Analisa o diff como um revisor de PR, procurando código de debug, nomes inadequados, arquivos desnecessários e violações das regras do `CLAUDE.md`. | Leitura |
| **mentor** | Explica o código e os conceitos em linguagem simples, utilizando a metáfora do restaurante. Propõe exercícios e perguntas de reflexão. É o agente responsável pelo objetivo de aprendizado. | Leitura |

## 2. Domínio do negócio

| Agente | O que faz | Permissão |
|---|---|---|
| **appointment-flow-auditor** | Protege o fluxo central do produto. Compara código, tabela de regras e diagrama, procurando estados sem saída, transições proibidas e falhas relacionadas a no-show, expiração e disputas. | Leitura |
| **payments-escrow-specialist** | Desenha e, no momento adequado, implementa o fluxo de pagamento retido: entidade `Payment`, comissão congelada, split, reembolso, webhooks idempotentes, conciliação e invariantes (nunca liberar e reembolsar o mesmo pagamento). | Escrita |
| **jobs-and-notifications-specialist** | Gerencia expirações, janelas de 24h e 48h, liberações automáticas, lembretes, e-mails e notificações push. Avalia o uso de `@nestjs/schedule` ou filas com BullMQ. | Escrita |
| **trust-and-safety-analyst** | Define regras de confiança: verificação de avaliadores, conflitos de interesse, reputação, penalidades, disputas, fraudes e abusos (como acordos entre avaliador e vendedor). | Leitura |
| **geo-search-specialist** | Implementa buscas por proximidade utilizando PostGIS e consultas SQL nativas quando necessário. Trabalha com ranking por distância, nota e preço. | Escrita |
| **media-storage-specialist** | Gerencia uploads de fotos dos anúncios e laudos, incluindo limites, tipos de arquivo, validações e armazenamento local, com possibilidade de migração futura para S3 ou similar. | Escrita |

## 3. Qualidade, processo e crescimento

| Agente | O que faz | Permissão |
|---|---|---|
| **git-release-manager** | Gerencia nomes de branches, Conventional Commits, descrições de PR, atualização do roadmap do README e changelog. | Escrita |
| **devops-ci-specialist** | Configura GitHub Actions (build, testes e banco de teste), Docker e variáveis de ambiente. Futuramente, também será responsável pelo deploy e hospedagem. | Escrita |
| **frontend-integration-specialist** | Faz a integração com o frontend: gera tipos a partir do OpenAPI (`openapi-typescript` ou `orval`), organiza chamadas, trata erros e controla a exibição de botões conforme o `myRole`. | Escrita |
| **performance-observability-specialist** | Analisa logs estruturados, padronização de erros, métricas, consultas N+1 e índices. | Leitura |
| **compliance-advisor** | Mapeia dados pessoais (LGPD), consentimento, retenção, termos de uso, política de cancelamento e regulamentação de pagamentos. Não substitui um advogado: identifica pontos de atenção e prepara perguntas para orientação jurídica. | Leitura |

---

# Lista de Skills

## 1. Construção (padrões do projeto)

| Skill | Para que serve |
|---|---|
| **new-nest-module** | Cria um módulo seguindo a estrutura padrão (`module`, `controller`, `service` e pasta `dto/`), incluindo `.js` nos imports e `import type` quando necessário. |
| **new-dto-set** | Gera DTOs de Create, Update (`PartialType`), Query e Response, incluindo mapper e decorators de validação e Swagger. |
| **response-dto-per-role** | Define o padrão para apresentar respostas diferentes conforme o perfil do usuário (ex.: avaliador visualiza a comissão, comprador não). |
| **ownership-check** | Implementa o padrão `assertOwner` e estabelece quando retornar `404` ou `403`. |
| **pagination-and-filters** | Implementa paginação com limite máximo, filtros dinâmicos e conversão de query strings. |
| **error-format** | Define um formato único de erro da API por meio de um filtro global de exceções. |
| **money-in-cents** | Estabelece regras e funções para trabalhar com dinheiro: valores em centavos, cálculo de comissão por subtração, arredondamento e teste da invariável `comissão + repasse = preço`. |
| **state-machine-pattern** | Ensina a modelar regras em tabelas e funções puras, separando as permissões de quem pode executar uma ação dos estados em que ela é permitida. |
| **scheduled-job-pattern** | Define a estrutura de tarefas agendadas idempotentes, como expirar, liberar e enviar lembretes. |
| **webhook-idempotency** | Garante que o mesmo aviso recebido duas vezes do provedor não seja processado mais de uma vez, armazenando o ID do evento. |
| **file-upload-pattern** | Define como validar, nomear e armazenar arquivos com segurança. |
| **postgis-proximity-query** | Implementa consultas de proximidade, como encontrar avaliadores em um raio de até X quilômetros, utilizando SQL nativo e índice geográfico. |

## 2. Banco de dados e ambiente

| Skill | Para que serve |
|---|---|
| **prisma-migration-workflow** | Define o fluxo de alterações no schema: editar, executar `format` e `migrate dev`, conferir se `enums.ts` e `models/` foram regenerados e garantir que a migration foi incluída no commit. Criada a partir de um problema que já enfrentamos. |
| **seed-dev-data** | Cria usuários de teste (comprador, vendedor, avaliador verificado e usuário externo), anúncios e agendamentos, evitando a necessidade de repetir cadastros manualmente a cada teste. |
| **reset-local-env** | Remove e recria o banco de dados do Docker, reaplica as migrations e executa o seed. |
| **env-sync-check** | Garante que todas as variáveis utilizadas no código estejam documentadas no `.env.example`, sem exposição de segredos reais. |

## 3. Qualidade e segurança

| Skill | Para que serve |
|---|---|
| **exhaustive-state-matrix-test** | Gera testes para todas as combinações de pessoa × ação × estado. |
| **e2e-appointment-scenarios** | Automatiza os 17 cenários de teste definidos no Swagger, transformando-os em testes reais. |
| **concurrency-test-pattern** | Executa duas ações simultaneamente e verifica que apenas uma delas seja concluída com sucesso. |
| **time-travel-test-pattern** | Testa expirações e janelas de tempo utilizando um relógio falso. |
| **security-checklist** | Fornece um checklist por rota: guards, ownership, validação, dados expostos, limites de tamanho e rate limit. |
| **swagger-completeness** | Verifica se todas as rotas documentam respostas de sucesso e erro, além de `@ApiBearerAuth` quando protegidas. |
| **pr-review-checklist** | Define o checklist de revisão de diffs: código de debug, segredos, vazamento de entities, imports não utilizados e CI aprovado. |
| **lgpd-data-map** | Cria um inventário de dados pessoais, identificando o que é armazenado, por que, por quanto tempo e quem pode visualizar. |

## 4. Processo e aprendizado

| Skill | Para que serve |
|---|---|
| **git-branch-pr-flow** | Documenta o fluxo desde `checkout -b` até o squash merge, seguindo os padrões de nomes e mensagens definidos no projeto. |
| **api-contract-sync** | Regenera os tipos do frontend a partir do OpenAPI e identifica possíveis incompatibilidades. |
| **troubleshoot-esm-nest-prisma** | Reúne soluções para erros que já enfrentamos: extensão `.js`, `rootDir`, `import type`, Prisma Client desatualizado, scripts bloqueados do npm e `bcrypt`. |
| **explain-simply** | Define o padrão de explicação solicitado: metáforas, exemplos práticos e resumo curto, sem aprofundamento desnecessário em versionamento. |
| **learning-exercise** | Gera exercícios práticos e perguntas de reflexão ao final de cada etapa de desenvolvimento. |
| **roadmap-update** | Atualiza o roadmap do README e o changelog após cada merge. |