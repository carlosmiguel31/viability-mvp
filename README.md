# Viabilidade de Fibra — Manchas de Cobertura + Pontos de Rede do Voalle

Sistema de consulta preliminar de viabilidade técnica para redes de fibra
óptica. **O operador consulta por endereço** (CEP, rua, número, bairro,
cidade, UF); as coordenadas são calculadas internamente por geocodificação no
backend.

> **Regra principal:** a mancha KML/KMZ é a fonte oficial da cobertura. Todo
> endereço localizado dentro de um polígono possui viabilidade preliminar
> (`PRELIMINARILY_VIABLE`); fora de todos os polígonos, `OUTSIDE_COVERAGE`.
> Os dados do Voalle são utilizados somente para localizar referências de
> rede e identificadores próximos, **não para aprovar ou reprovar a
> cobertura** (`networkReferenceStatus`: `FOUND` · `NOT_FOUND` ·
> `VOALLE_UNAVAILABLE` · `NOT_CHECKED`). Áreas com qualquer nomenclatura no
> arquivo (ex.: "IMPLANTAR - POP VTA") são manchas válidas — o nome é apenas
> exibido.

O modelo real do sistema é:

- **O arquivo KML/KMZ contém manchas de cobertura (polígonos)** — e **não**
  pontos de CTO.
- **Os pontos físicos de rede vêm do PostgreSQL do Voalle**, na tabela
  `erp.authentication_splitters` (acesso **exclusivamente de leitura**).
- **Registros com a mesma coordenada são agrupados** em um único ponto físico
  de rede. Os elementos agrupados podem ter títulos como `SPLITTER`, `ROTA`
  ou `COLETOR` — por isso o modelo se chama "elemento de rede", não "splitter".
- **O sistema não consulta nem apresenta ocupação de portas.**
- **O resultado é uma análise geográfica preliminar** e sempre depende de
  validação técnica.

- **Títulos técnicos são ocultados do operador**: `SPLITTER 1_48`,
  `ROTA 01_1942`, `COLETOR ...` nunca aparecem na interface. Apenas
  **identificadores padronizados de rede** (ex.: `BHZ-C0016-RT10-CT03_2780`)
  são exibidos.

> O sistema utiliza um PostgreSQL próprio para usuários, sessões e auditoria.
> O banco do Voalle permanece exclusivamente de leitura — sem escrita e sem
> tabelas criadas ou alteradas nele. Nenhum endereço consultado é gravado ou
> persistido. Ao reiniciar o backend, o arquivo de cobertura é reprocessado
> do zero e mantido apenas em memória.

## Arquitetura

```text
Endereço do operador (CEP → preenchimento automático via ViaCEP)
      ↓
AddressViabilityService (normaliza → geocodifica pelo backend)
      ↓ latitude/longitude
CoordinateViabilityService (mesma lógica geográfica, nada duplicado)
      ↓
… fluxo geográfico abaixo …

KML/KMZ de manchas (NETWORK_COVERAGE_PATH)
      ↓
Coverage Loader (.kml direto ou KML dentro do .kmz)
      ↓
Parser de polígonos (Polygon, MultiGeometry, anéis externos e buracos)
      ↓
Store singleton em memória (CoverageArea[])
      ↓
Point-in-polygon (ray casting, even-odd)          ← consulta de viabilidade
      ↓ (somente se o ponto estiver DENTRO de alguma mancha)
Repositório Voalle (SELECT-only, caixa geográfica parametrizada)
      ↓
Validação + agrupamento por coordenada → NetworkLocation[]
      ↓
Classificação pela presença dentro da mancha; busca complementar de
referências do Voalle dentro do raio configurado → resposta REST
      ↑
Frontend React + Leaflet (manchas, ponto consultado, pontos de rede)
```

## Tipos reais confirmados no Voalle

| Coluna | Tipo | Campo na aplicação |
|---|---|---|
| `active` / `deleted` | `boolean` | filtrados no SQL: `active IS TRUE AND COALESCE(deleted, FALSE) = FALSE` — registros inativos ou apagados nunca entram na análise |
| `id` | `bigint` | `id` (**mantido como string** — nunca convertido com `Number`, para não perder precisão; ordenação com `BigInt` e fallback determinístico por string) |
| `title` | `character varying` | `title` |
| `street` | — | `street` |
| `number` | — | `addressNumber` |
| `neighborhood` | — | `neighborhood` |
| `city` | — | `city` |
| `postal_code` | — | `postalCode` |
| `lat` | `character varying` | `latitude` |
| `lng` | `character varying` | `longitude` |

Como `lat`/`lng` são texto, o SQL valida com regex **antes** do cast:

```sql
SELECT id, title, street, number, neighborhood, city, postal_code, lat, lng
FROM erp.authentication_splitters
WHERE active IS TRUE
  AND COALESCE(deleted, FALSE) = FALSE
  AND lat IS NOT NULL AND lng IS NOT NULL
  AND btrim(lat) ~ '^[+-]?[0-9]+([.][0-9]+)?$'
  AND btrim(lng) ~ '^[+-]?[0-9]+([.][0-9]+)?$'
  AND btrim(lat)::double precision BETWEEN $1 AND $2
  AND btrim(lng)::double precision BETWEEN $3 AND $4
ORDER BY id ASC
```

Parâmetros: `[minLat, maxLat, minLng, maxLng]` (caixa geográfica calculada na
aplicação, sem PostGIS). Coordenadas nunca são interpoladas na string SQL. Na
aplicação, cada linha é convertida com `Number`, validada nos limites
geográficos, o par `0,0` é ignorado, e o filtro final usa **Haversine** —
um registro inválido nunca derruba a consulta.

**Por verificação de viabilidade é feita no máximo 1 consulta ao Voalle** (e
zero quando o ponto está fora da cobertura).

## Consulta por endereço

Fluxo do `POST /api/viabilities/check`:

1. valida e normaliza o endereço (CEP só dígitos com 8 posições; trim e
   colapso de espaços; UF maiúscula; acentos preservados; rua, número,
   cidade e UF obrigatórios; país padrão Brasil);
2. geocodifica **pelo backend** (`GeocodingProvider` — a chave nunca vai ao
   navegador e endereços completos não são registrados em logs de produção);
3. trata falhas com status próprios, **sem consultar o Voalle** e sem jamais
   usar coordenadas estimadas silenciosamente:
   - `ADDRESS_NOT_FOUND` — endereço não localizado;
   - `ADDRESS_AMBIGUOUS` — correspondência parcial (qualquer confiança) OU
     confiança baixa: o operador confirma/ajusta o ponto no mapa (as
     coordenadas retornam apenas para posicionar o marcador);
   - `GEOCODING_UNAVAILABLE` — serviço fora do ar (não afirma viabilidade);
4. com coordenadas válidas, segue o fluxo geográfico: a **presença dentro
   da mancha define a viabilidade**; o Voalle entra só como referência;
5. quando o operador **ajusta o marcador**, a nova coordenada vale apenas
   para aquela consulta (`adjustedLocation` no body,
   `manuallyAdjusted: true` na resposta) e dispensa nova geocodificação.

**Preenchimento pelo CEP** (`GET /api/addresses/postal-code/:cep`): camada
desacoplada (`PostalCodeProvider`, implementação ViaCEP — serviço público
brasileiro, sem chave). CEP válido preenche rua/bairro/cidade/UF; o número
nunca é substituído; o operador pode corrigir tudo; CEP não encontrado gera
aviso amigável; indisponibilidade não bloqueia a digitação manual.

**Provider de geocodificação** (`GEOCODING_PROVIDER`):
- `google` (produção): Google Geocoding API; configure
  `GOOGLE_GEOCODING_API_KEY` (crie a chave no Google Cloud Console com a
  Geocoding API habilitada e restrinja por IP do backend). `ROOFTOP` →
  confiança HIGH; `RANGE_INTERPOLATED` → MEDIUM; demais → LOW;
  `partial_match` ou múltiplos resultados → localização ambígua.
- `dev` (somente desenvolvimento): retorna a coordenada fixa de
  `DEV_GEOCODING_FIXED_LAT/LNG` com confiança LOW + partialMatch, sempre
  exigindo confirmação no mapa. Sem essas variáveis, declara-se indisponível.

## Identificação exibida ao operador

Os títulos de `erp.authentication_splitters` são classificados por
`classifyNetworkElementTitle` (`NETWORK_IDENTIFIER` · `SPLITTER` · `ROUTE` ·
`COLLECTOR` · `OTHER`). O padrão dos identificadores é centralizado e
configurável (`NETWORK_IDENTIFIER_PATTERN`, padrão
`^[A-Z0-9]+-C[0-9]+-RT[0-9]+-CT[0-9]+_[0-9]+$`, comparação sem diferenciar
maiúsculas, valor original preservado — **não** presume prefixo `BHZ`).

Na resposta pública (`PublicNetworkLocation`), apenas os títulos
classificados como identificadores viram `identifiers` (`{id, code}`,
duplicados removidos, ordem alfabética, todos mantidos). Títulos técnicos,
endereços internos dos elementos e qualquer noção de portas ficam fora. Sem
identificador útil: `identifiers: []`, `identificationStatus:
"NOT_IDENTIFIED"`, interface mostra "Ponto de rede localizado, porém sem
identificação padronizada no cadastro" — o ponto segue na análise geográfica,
mas exige confirmação técnica.

## Como funciona o agrupamento

Registros com **exatamente a mesma coordenada** (normalizada com 7 casas
decimais: `lat.toFixed(7),lng.toFixed(7)`) viram um único `NetworkLocation`:

- elementos ordenados por `id`;
- distância calculada uma única vez por ponto físico;
- endereço = primeiro endereço não vazio do grupo (na ordem de id);
- pontos apenas *próximos* (coordenadas diferentes) **não** são agrupados;
- nada de portas: ocupação/capacidade não é somada nem exibida.

## Resultados

| `status` | Significado |
|---|---|
| `PRELIMINARILY_VIABLE` | Endereço dentro de **qualquer** mancha |
| `OUTSIDE_COVERAGE` | Endereço fora de **todas** as manchas (o Voalle não é consultado) |
| `COVERAGE_NOT_LOADED` | Arquivo de cobertura não carregado |
| `ADDRESS_NOT_FOUND` | Endereço não localizado |
| `ADDRESS_AMBIGUOUS` | Localização parcial **ou** com confiança baixa — exige confirmação no mapa |
| `GEOCODING_UNAVAILABLE` | Serviço de geocodificação indisponível |

A viabilidade é definida **exclusivamente** pela mancha KML/KMZ. A situação
da referência de rede vem em um campo separado:

| `networkReferenceStatus` | Significado |
|---|---|
| `FOUND` | Referência de rede localizada no raio de busca (ponto mais próximo, distância, identificadores, alternativas) |
| `NOT_FOUND` | Nenhuma referência no raio — mensagem complementar neutra |
| `VOALLE_UNAVAILABLE` | Voalle fora do ar — a cobertura confirmada pela mancha permanece |
| `NOT_CHECKED` | Voalle não consultado (fora da cobertura ou falha de geocodificação) |

**Esses estados nunca alteram a viabilidade confirmada pela mancha** — são
informação complementar para a equipe técnica.


Sobreposição de manchas: todas as áreas que contêm o ponto são retornadas;
a **área principal é a primeira área válida na ordem de leitura do KML**
(regra explícita, documentada e testada).

Bordas de polígono (tolerância `1e-7` grau ≈ 1,1 cm, planar): ponto sobre a
borda ou vértice do **anel externo** é considerado **dentro** da cobertura;
ponto sobre a borda de um **buraco** é considerado **fora** daquela cobertura.
O resultado não depende do sentido nem da ordem dos vértices.

## Pré-requisitos

- **Node.js 20.19+ ou 22.12+** (o Prisma 7 e seu client engine-free exigem
  essas versões mínimas; os `package.json` declaram `engines.node >=20.19.0`)
- npm
- PostgreSQL para o **banco da aplicação** (usuários, sessões, auditoria)
- Acesso de rede ao PostgreSQL do Voalle (somente leitura)

## Arquitetura dos dois bancos

| Banco | Conexão | Acesso | Uso |
|---|---|---|---|
| **Aplicação** | `APP_DATABASE_URL` (Prisma) | leitura **e escrita** | usuários, refresh tokens (hash), auditoria |
| **Voalle** | `VOALLE_DB_*` (pg parametrizado) | **exclusivamente leitura** | `erp.authentication_splitters` |

O Prisma é usado **somente** para o banco da aplicação
(`backend/src/db/prisma.ts`); o Voalle continua no repositório dedicado
(`backend/src/repositories/voalle.repository.ts`) com `SELECT` parametrizado
e nunca passa pelo Prisma. Nenhuma tabela é criada ou alterada no banco do
Voalle.

## Instalação e execução

```bash
# Backend (porta 3001)
cd backend
npm ci
cp .env.example .env       # ajuste as variáveis (bancos, JWT, seed)
npx prisma generate        # gera o client do banco da aplicação
npx prisma migrate dev     # cria as tabelas (usa APP_DATABASE_URL)
npm run seed               # cria o primeiro administrador
npm run dev

# Frontend (porta 5173, proxy /api → 3001)
cd ../frontend
npm ci
npm run dev
```

Build de produção: `npm run build` em cada pasta (`npm start` no backend).
Em produção use `npx prisma migrate deploy` em vez de `migrate dev`.

### Primeiro administrador (seed)

Defina no `.env` antes de `npm run seed`:

```env
SEED_ADMIN_NAME=Nome do Administrador
SEED_ADMIN_EMAIL=admin@empresa.com.br
SEED_ADMIN_PASSWORD=<senha forte temporária>
```

O seed cria o administrador **apenas quando não existe**, nunca sobrescreve
a senha, não registra a senha no terminal e falha se a senha não cumprir a
política (mínimo 8 caracteres com maiúscula, minúscula e número).
**A senha inicial deve ser alterada após o primeiro acesso.**

## Camadas de cobertura por parceiro (v0.3.0)

A cobertura deixou de ser um arquivo único definido em
`NETWORK_COVERAGE_PATH` e passou a ser administrada como **parceiros**
(`CoveragePartner`) e **camadas** (`CoverageLayer`), cada camada com seu
próprio arquivo KML/KMZ, versão e status de ativação.

### Armazenamento dos arquivos

- Os arquivos importados ficam em `COVERAGE_STORAGE_PATH`
  (padrão `./storage/coverage`), criado automaticamente e **nunca**
  publicado como conteúdo estático.
- O nome enviado pelo usuário jamais vira caminho: cada arquivo recebe um
  nome interno aleatório (`uuid.kml`/`uuid.kmz`), o que impede path
  traversal e sobrescrita. Nomes internos nunca são expostos pela API.
- Aceitos apenas `.kml` e `.kmz`, com validação de extensão e conteúdo,
  SHA-256 calculado, rejeição de arquivo vazio e limite de
  `COVERAGE_MAX_FILE_SIZE_MB` (padrão 25 MB). As proteções contra KMZ
  excessivo/zip bomb da v0.2.x continuam valendo.
- O conteúdo binário **não** é armazenado no PostgreSQL.

### Processamento e ativação

Cada camada passa por `PENDING → PROCESSING → READY` (ou `FAILED`, com
mensagem segura e sem stack trace). Elementos ignorados: `Point` e
`LineString` não são áreas de cobertura e apenas entram na contagem
`ignoredGeometryCount`; um arquivo **sem nenhum polígono válido** é marcado
como `FAILED`.

Entram no índice de consulta (snapshot em memória) somente camadas com
`active = true`, `processingStatus = READY` **e parceiro ativo**. Criar,
ativar, inativar ou excluir camadas — e ativar/inativar parceiros —
reconstrói o snapshot de forma **atômica e serializada**: o novo índice é
montado à parte e só substitui o atual após sucesso; em falha, o snapshot
anterior continua atendendo as consultas, sem intervalo sem cobertura.

### Camadas sobrepostas

Quando o ponto consultado está dentro de polígonos de mais de uma camada
(ou parceiro), a resposta lista **todos** os matches em `coverageMatches`,
sem duplicações. A regra de viabilidade não muda:
`coverageMatches.length > 0` ⇒ `PRELIMINARILY_VIABLE`; fora de todos os
polígonos ativos ⇒ `OUTSIDE_COVERAGE`. Sem nenhuma camada ativa cadastrada,
a consulta responde `COVERAGE_NOT_CONFIGURED` (nunca "fora da cobertura"
silencioso). O Voalle continua meramente complementar.

### Importação por linha de comando

```bash
cd backend
npm run coverage:import -- --file "./data/rede-neutra-real.kml" \
  --partner "Rede Neutra" --code "REDE_NEUTRA" --layer "Cobertura inicial" \
  --version "2026-07"
```

O comando cria ou localiza o parceiro pelo `code`, importa o arquivo com as
mesmas validações do upload, mostra as estatísticas e **recusa duplicidade
pelo SHA-256** com erro claro. A importação nunca roda automaticamente na
inicialização.

### Compatibilidade com `NETWORK_COVERAGE_PATH` (legado/depreciado)

A variável continua existindo apenas como referência de migração: o backend
**não** importa o arquivo automaticamente. Se não houver camada cadastrada e
a variável estiver definida, um aviso no log indica o comando
`coverage:import` exato para migrar. O arquivo real de cobertura pode conter
informações operacionais e não deve ser versionado (o `.gitignore` ignora
`data/*.kml`/`data/*.kmz`, liberando apenas o demo).

### Tela de administração (frontend)

O menu **Coberturas** (exclusivo de ADMIN) abre a administração com duas
abas:

- **Parceiros** — busca, filtro Todos/Ativos/Inativos, paginação (20 por
  página), criação e edição em modal (código em fonte monoespaçada, gravado
  em maiúsculas pelo backend) e ativação/inativação com confirmação
  explícita de que as camadas do parceiro deixarão de participar das
  consultas.
- **Camadas** — busca, filtros por parceiro, status ativo, processamento e
  tipo; tabela com arquivo original, tamanho legível (B/KB/MB), versão,
  badge de processamento (Aguardando processamento / Processando / Pronta /
  Falhou — com o motivo da falha em detalhes expansíveis), áreas, polígonos
  e ações. Upload de KML/KMZ em modal com validações locais (parceiro, nome
  e arquivo obrigatórios; apenas `.kml`/`.kmz`; não vazio; até 25 MB) além
  das validações do backend; durante o envio o formulário fica desabilitado
  com "Enviando e processando…". A edição altera somente nome, descrição e
  versão — arquivo e parceiro não são substituíveis (envie uma nova camada).
  A exclusão é definitiva, confirmada com nome, parceiro e arquivo. O botão
  "Recarregar coberturas" reconstrói o snapshot sob confirmação e mostra o
  resumo (parceiros, camadas, áreas, polígonos e duração).

O cabeçalho resume o snapshot ("2 parceiro(s) · 4 camada(s) · …"), mostra
"Nenhuma cobertura configurada" quando `configured = false` e "Status da
cobertura indisponível" quando a requisição falha; toda operação
administrativa atualiza esse status sem recarregar a página. No resultado da
consulta, a seção **"Coberturas encontradas"** lista parceiro, camada e
versão de cada match (sem IDs internos), e o status
`COVERAGE_NOT_CONFIGURED` tem apresentação própria ("Cobertura não
configurada") com a mensagem enviada pelo backend.

### Permissões

| Perfil | Parceiros/Camadas |
| --- | --- |
| `ADMIN` | leitura e gerenciamento completos (criar, editar, ativar/inativar, upload, excluir) |
| `OPERATOR`, `TECHNICIAN`, `VIEWER` | apenas lista básica de parceiros e camadas **ativas** (sem caminhos internos, sem upload, sem ativação/exclusão) |

Nenhum perfil recebe `storedFileName`, caminho físico, stack trace ou
detalhes internos de armazenamento.

### Códigos de erro da cobertura

`COVERAGE_PARTNER_NOT_FOUND`, `COVERAGE_PARTNER_CODE_IN_USE`,
`COVERAGE_LAYER_NOT_FOUND`, `COVERAGE_FILE_INVALID`,
`COVERAGE_FILE_TOO_LARGE`, `COVERAGE_FILE_DUPLICATE`,
`COVERAGE_PROCESSING_FAILED`, `COVERAGE_LAYER_PROCESSING`,
`COVERAGE_NOT_CONFIGURED`, `COVERAGE_SNAPSHOT_REBUILD_FAILED` — todos no
padrão de erro `{ "error": { "code", "message" } }` do projeto.

## Testes

```bash
cd backend
npm test        # exige um banco PostgreSQL de teste em APP_DATABASE_URL
npm run lint

cd ../frontend
npm test
```

Os testes do backend usam um banco real da aplicação. Crie um banco
**exclusivo de testes** e aponte `APP_DATABASE_URL` para ele ao rodar
`npm test`:

```sql
CREATE DATABASE viability_app_test OWNER viability;
```

Aplique as migrations no banco de teste **antes** da primeira execução dos
testes (o `migrate deploy` usa a `APP_DATABASE_URL` ativa):

```bash
APP_DATABASE_URL=postgresql://viability:senha@localhost:5432/viability_app_test   npx prisma migrate deploy

APP_DATABASE_URL=postgresql://viability:senha@localhost:5432/viability_app_test npm test
```

**Proteção do banco de teste**: antes de qualquer limpeza (`deleteMany`),
os testes exigem `NODE_ENV=test` **e** que o nome do banco na URL esteja
explicitamente identificado como de teste (termina com `_test` ou contém
`test`); caso contrário abortam com "Os testes só podem limpar um banco
explicitamente identificado como banco de teste." — uma URL de produção
nunca é aceita silenciosamente. Mocks do Voalle existem somente nos testes. O fixture
`backend/tests/fixtures/coverage.kml` cobre polígono com buraco,
MultiGeometry, sobreposição, linha e ponto ignorados e geometria inválida.

## Variáveis de ambiente

Veja `backend/.env.example`. Resumo:

| Grupo | Variáveis |
|---|---|
| Servidor | `PORT`, `NODE_ENV` |
| Cobertura | `NETWORK_COVERAGE_PATH` |
| Limites do arquivo | `MAX_KMZ_COMPRESSED_BYTES`, `MAX_KMZ_UNCOMPRESSED_BYTES`, `MAX_KMZ_ENTRIES`, `MAX_KML_BYTES` |
| Voalle | `VOALLE_DB_HOST`, `VOALLE_DB_PORT`, `VOALLE_DB_NAME`, `VOALLE_DB_USER`, `VOALLE_DB_PASSWORD`, `VOALLE_DB_SSL`, timeouts |
| Referência de rede | `NETWORK_REFERENCE_SEARCH_RADIUS_METERS` (300), `MAX_NETWORK_ALTERNATIVES` (5) |
| Geocodificação | `GEOCODING_PROVIDER` (google/dev), `GOOGLE_GEOCODING_API_KEY`, `GEOCODING_TIMEOUT_MS` (5000), `DEV_GEOCODING_FIXED_LAT/LNG` (só dev) |
| CEP | `POSTAL_CODE_TIMEOUT_MS` (5000) |
| Identificadores | `NETWORK_IDENTIFIER_PATTERN` |
| Banco da aplicação | `APP_DATABASE_URL` |
| Autenticação | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥ 32 caracteres, diferentes entre si), `JWT_ACCESS_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (7d), `BCRYPT_ROUNDS` (12), `COOKIE_SECURE` (auto) |
| Seed | `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` |
| Limpeza de sessões | `AUTH_CLEANUP_RETENTION_DAYS` (30) — usado por `npm run auth:cleanup` |
| Segurança | `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY` |


## Endpoints

| Método | Rota | Proteção | Descrição |
|---|---|---|---|
| POST | `/api/auth/login` | rate limit dedicado | Login → access token + cookie de refresh |
| POST | `/api/auth/refresh` | cookie HttpOnly | Rotaciona o refresh e emite novo access |
| POST | `/api/auth/logout` | cookie HttpOnly | Encerra a sessão atual |
| GET | `/api/auth/me` | JWT | Usuário autenticado |
| POST | `/api/auth/change-password` | JWT | Altera a própria senha (revoga todas as sessões) |
| POST | `/api/viabilities/check` | JWT (qualquer perfil) + rate limit | Consulta por **endereço** `{address, adjustedLocation?}` |
| POST | `/api/viabilities/confirm-location` | JWT (qualquer perfil) + rate limit | Confirmação/ajuste do marcador (mesmo contrato do check com `adjustedLocation`) |
| POST | `/api/viabilities/check-coordinates` | dev: JWT · fora de dev: ADMIN | Ferramenta de desenvolvimento (coordenadas diretas) |
| GET | `/api/addresses/postal-code/:cep` | JWT + rate limit | Preenchimento pelo CEP (ViaCEP) |
| GET | `/api/coverage/status` | JWT | Resumo do snapshot de cobertura (parceiros, camadas, polígonos) |
| GET | `/api/coverage/areas` | JWT | Polígonos das camadas ativas para o mapa |
| POST | `/api/coverage/reload` | JWT + perfil ADMIN + rate limit | Reconstrói o snapshot a partir do banco (auditado) |
| POST | `/api/coverage/partners` | JWT + ADMIN | Cria parceiro (`code` único) |
| GET | `/api/coverage/partners` | JWT | Lista parceiros (`search`, `active`, `page`, `limit`; não-admin vê só ativos) |
| GET | `/api/coverage/partners/:id` | JWT + ADMIN | Detalhe do parceiro |
| PATCH | `/api/coverage/partners/:id` | JWT + ADMIN | Edita nome/código/descrição |
| PATCH | `/api/coverage/partners/:id/status` | JWT + ADMIN | Ativa/inativa (reconstrói o snapshot) |
| POST | `/api/coverage/layers` | JWT + ADMIN | Upload `multipart/form-data` (`file`, `partnerId`, `name`, `description?`, `version?`, `active?`) |
| GET | `/api/coverage/layers` | JWT | Lista camadas (`search`, `partnerId`, `active`, `processingStatus`, `fileType`, `page`, `limit`; não-admin: lista básica de ativas) |
| GET | `/api/coverage/layers/:id` | JWT + ADMIN | Detalhe da camada (nunca expõe o nome interno do arquivo) |
| PATCH | `/api/coverage/layers/:id` | JWT + ADMIN | Edita nome/descrição/versão |
| PATCH | `/api/coverage/layers/:id/status` | JWT + ADMIN | Ativa/inativa (reconstrói o snapshot) |
| DELETE | `/api/coverage/layers/:id` | JWT + ADMIN | Exclui registro + arquivo físico + snapshot (recusado durante `PROCESSING`) |
| GET | `/api/users` e demais rotas de usuários | JWT + perfil ADMIN | Administração de usuários |
| GET | `/api/audit-logs` | JWT + perfil ADMIN | Auditoria com paginação e filtros |
| GET | `/api/health` | pública | Health check |

### Frontend em outra origem

Em desenvolvimento o proxy do Vite encaminha `/api` ao backend (variável
vazia). Quando o frontend for servido em outra origem, configure no build:

```env
VITE_API_BASE_URL=https://api.exemplo.com
```

Todas as chamadas usam `${VITE_API_BASE_URL}/api/...` (barra final removida
automaticamente). Lembre de incluir a origem do frontend em
`CORS_ALLOWED_ORIGINS` no backend.

## Autenticação e sessões (v0.2.0)

Login por e-mail e senha com JWT:

- **Access token** (15 min): devolvido no corpo do login/refresh e mantido
  pelo frontend **apenas em memória** — nunca em `localStorage` ou
  `sessionStorage`. Enviado em `Authorization: Bearer`.
- **Refresh token** (7 dias): cookie **HttpOnly**, `SameSite=Strict`,
  `Path=/api/auth`, `Secure` em produção (`COOKIE_SECURE=auto`). O banco
  guarda somente o **hash SHA-256** do token, nunca o token puro.
- **Rotação**: cada refresh invalida o token utilizado e emite um novo na
  mesma família de sessão. **Reuso** de um token já rotacionado revoga a
  família inteira (detecção básica de roubo).
- Sessões independentes por dispositivo: um novo login **não** derruba os
  anteriores; logout encerra apenas a sessão atual; inativação ou reset de
  senha revogam todas as sessões do usuário; usuário inativo não renova.
- Mudança de perfil vale a partir do próximo token emitido (o refresh relê
  o papel no banco) — o frontend atualiza o cabeçalho automaticamente com o
  usuário devolvido pela renovação, sem recarregar a página.
- **Inativação vale imediatamente**: além da assinatura do access token, o
  `requireAuth` confirma no banco da aplicação que o usuário segue ativo —
  um usuário inativado recebe 401 na próxima requisição, sem esperar o
  token expirar.
- **Concorrência de renovação**: o consumo do refresh token é atômico no
  banco (`updateMany` condicional — só uma requisição rotaciona). No
  frontend, uma promessa compartilhada garante um único refresh por aba e o
  Web Locks API (`viability-auth-refresh`) coordena renovações entre abas
  (com fallback quando indisponível). Um token recém-rotacionado apresentado
  de novo dentro da janela de graça (10 s) é tratado como corrida legítima;
  fora dela, como reuso malicioso — e a família inteira é revogada.
- **Duração do cookie**: o `Max-Age` do cookie, o `exp` do JWT de refresh e
  o `expiresAt` persistido derivam todos de `JWT_REFRESH_EXPIRES_IN`
  (fonte única em `src/utils/duration.ts`) — o cookie não é mais apenas de
  sessão do navegador.
- **Alterar a própria senha**: `POST /api/auth/change-password`
  (`currentPassword`, `newPassword`, `confirmPassword`) exige a senha atual,
  aplica a política, recusa nova senha igual à atual, revoga **todas** as
  sessões na mesma transação, limpa o cookie e registra
  `USER_PASSWORD_CHANGED` — novo login obrigatório. No frontend, menu
  "Alterar minha senha".
- **Limpeza periódica**: `npm run auth:cleanup` remove refresh tokens
  expirados ou revogados há mais de `AUTH_CLEANUP_RETENTION_DAYS` dias
  (padrão 30). Agende a execução periódica (ex.: cron diário) — a limpeza
  não roda a cada requisição.
- Senhas com **bcrypt** (12 rounds) e política mínima de 8 caracteres com
  maiúscula, minúscula e número. Mensagem de login sempre genérica
  ("E-mail ou senha inválidos.") e rate limit dedicado contra brute force.

### Proteção CSRF do refresh/logout

O cookie usa `SameSite=Strict` e caminho restrito a `/api/auth`, portanto
navegadores não o anexam em requisições iniciadas por outros sites; o CORS
restringe as origens que conseguem ler respostas. Como access tokens vão no
header `Authorization` (imune a CSRF), nenhuma rota de negócio depende de
cookie. Se o frontend for servido em **outra origem**, `SameSite=Strict`
bloqueará o cookie — nesse cenário sirva frontend e API sob o mesmo domínio
(ex.: proxy reverso em `/api`) ou adapte o `sameSite` com proteção adicional.

### Perfis e matriz de permissões

| Perfil | Rótulo | Consultas (viabilidade, CEP, cobertura) | Próprio perfil (`/auth/me`) | Usuários e auditoria | Recarga de manchas |
|---|---|---|---|---|---|
| `ADMIN` | Administrador | ✅ | ✅ | ✅ | ✅ |
| `OPERATOR` | Operador | ✅ | ✅ | ❌ (403) | ❌ (403) |
| `TECHNICIAN` | Técnico (preparado para futuras validações técnicas) | ✅ | ✅ | ❌ (403) | ❌ (403) |
| `VIEWER` | Visualizador | ✅ | ✅ | ❌ (403) | ❌ (403) |

O frontend esconde menus e ações sem permissão, mas a autorização real é do
backend: sem token → **401**; autenticado sem permissão → **403**. Não há
exclusão física de usuários (ativo/inativo), e-mails são únicos ignorando
maiúsculas, o último ADMIN ativo não pode ser rebaixado nem inativado e a
auto-inativação exige confirmação explícita.

### Auditoria

Ações registradas no banco da aplicação: `LOGIN_SUCCESS`, `LOGIN_FAILED`,
`LOGOUT`, `USER_CREATED`, `USER_UPDATED`, `USER_ACTIVATED`,
`USER_DEACTIVATED`, `USER_ROLE_CHANGED`, `USER_PASSWORD_RESET`,
`COVERAGE_RELOADED`. A trilha nunca guarda senhas, hashes, tokens, chaves,
credenciais do Voalle nem endereços completos, e é acessível apenas por
ADMIN em `GET /api/audit-logs` (paginação e filtros por usuário, ação e
intervalo de datas). Consultas de viabilidade não são auditadas nesta
versão.

### Migração da chave compartilhada (0.1.x → 0.2.0)

A autenticação provisória por `INTERNAL_API_KEY`/`ADMIN_API_KEY` foi
**totalmente removida**: não há mais tela de chave, `sessionStorage` nem
header `x-api-key`. Passos ao atualizar:

1. Crie o banco da aplicação e rode `npx prisma migrate dev` e `npm run seed`;
2. Configure `APP_DATABASE_URL`, `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`
   (≥ 32 caracteres, diferentes entre si — `openssl rand -hex 32`);
3. Remova `INTERNAL_API_KEY` e `ADMIN_API_KEY` do `.env` (não são mais lidas);
4. Distribua usuários e senhas pelos perfis adequados na tela **Usuários**.

O cliente HTTP do frontend renova o access token automaticamente: em 401 faz
**uma** tentativa de refresh e repete a requisição; se falhar, volta ao
login (sem loop infinito).

### Atrás de proxy (Nginx/Cloudflare)

Por padrão o Express **não** confia em headers de proxy. Em produção atrás
de proxy reverso, habilite explicitamente para o rate limiting identificar
o IP real:

```env
TRUST_PROXY=true   # 1 salto (Nginx na frente)
# ou o numero de saltos, ex.: TRUST_PROXY=2 (Cloudflare + Nginx)
```

Nunca habilite de forma irrestrita sem proxy na frente.

## Segurança do acesso ao Voalle

> O usuário configurado para acesso ao Voalle deve possuir exclusivamente
> permissão de leitura na tabela `erp.authentication_splitters`.

1. **Usuário do banco** (garantia mais forte):

   ```sql
   CREATE USER viabilidade_ro WITH PASSWORD '...';
   GRANT CONNECT ON DATABASE voalle TO viabilidade_ro;
   GRANT USAGE ON SCHEMA erp TO viabilidade_ro;
   GRANT SELECT ON erp.authentication_splitters TO viabilidade_ro;
   ```

2. **Sessão read-only**: o pool conecta com `default_transaction_read_only=on`.
3. **Validação na aplicação**: `assertReadOnlySql()` só permite `SELECT`/`WITH`
   de instrução única (coberto por teste).

Também estão ativos: Helmet, rate limiting (viabilidade e recarga), CORS
configurável, validação Zod, timeouts de conexão/consulta, handler global de
erros (sem stack trace/SQL em produção), handler de rota inexistente e
graceful shutdown (SIGINT/SIGTERM fecham o servidor HTTP e o pool).

## Exemplo de resposta

```json
{
  "status": "PRELIMINARILY_VIABLE",
  "message": "O endereço está dentro da área de cobertura e possui viabilidade preliminar.",
  "networkReferenceStatus": "FOUND",
  "networkReferenceMessage": null,
  "searchedAddress": {
    "input": { "postalCode": "30640000", "street": "Rua Exemplo", "number": "100", "complement": null, "neighborhood": "Barreiro", "city": "Belo Horizonte", "state": "MG" },
    "formattedAddress": "Rua Exemplo, 100 - Barreiro, Belo Horizonte - MG",
    "latitude": -19.9878,
    "longitude": -44.0128,
    "geocodingConfidence": "HIGH",
    "manuallyAdjusted": false
  },
  "coverage": {
    "insideCoverage": true,
    "primaryArea": { "internalId": "…", "name": "BARREIRO", "folderPath": "AREA DE ATENDIMENTO" },
    "matchingAreas": []
  },
  "nearestNetworkLocation": {
    "internalId": "…",
    "latitude": -19.9879,
    "longitude": -44.0127,
    "distanceMeters": 74.5,
    "identifiers": [
      { "id": "2780", "code": "BHZ-C0016-RT10-CT03_2780" },
      { "id": "2787", "code": "BHZ-C0016-RT11-CT04_2787" }
    ],
    "identificationStatus": "IDENTIFIED"
  },
  "alternatives": [],
  "requiresTechnicalConfirmation": true,
  "analysisBasis": "Análise geográfica preliminar…"
}
```

A resposta nunca inclui portas (totais/ocupadas/livres), capacidade,
disponibilidade estimada, clientes conectados, CPF, CNPJ ou telefone.

## Limitações atuais

- Geocodificação depende de provider externo (Google) — custos e limites da
  API se aplicam; o provider `dev` serve apenas para desenvolvimento.
- A análise continua sendo preliminar: identificadores exibidos dependem da
  qualidade do cadastro no Voalle.
- Upload de arquivo via API não implementado — leitura pelo caminho do `.env`.
- Point-in-polygon planar (ray casting) — adequado para manchas municipais;
  não trata polígonos que cruzam o antimeridiano.
- Agrupamento apenas por coordenada exatamente igual (7 casas); pontos
  ligeiramente divergentes aparecem separados.
- Ocupação/disponibilidade de portas não é consultada nem exibida.
- Sem recuperação de senha self-service: a redefinição é feita por um ADMIN.
- Sem histórico persistente de consultas, upload de KML/KMZ pela interface
  ou gerenciamento de múltiplas redes (planejados para versões futuras).
- Cookie de refresh com `SameSite=Strict` pressupõe frontend e API na mesma
  origem (ou atrás do mesmo proxy reverso).
- O resultado é sempre preliminar e requer validação técnica.

## Histórico de consultas (v0.4.0)

Toda consulta de viabilidade finalizada (viável, fora da cobertura, endereço
ambíguo, cobertura não configurada, geocodificação indisponível etc.) é
persistida em um histórico **imutável** antes de a resposta ser enviada — a
resposta e o registro representam sempre o mesmo resultado. Não existem
endpoints de edição ou exclusão; renomear, inativar ou excluir camadas nunca
altera consultas antigas, porque o registro guarda um snapshot com os nomes de
parceiro/camada e a versão da época.

### Protocolo

Cada consulta recebe um protocolo público no formato `VIA-AAAAMMDD-XXXXXXXX`
(sufixo de 8 caracteres gerado com `crypto.randomBytes`, alfabeto sem
caracteres ambíguos; índice `unique` no banco e nova tentativa com novo sufixo
em caso de colisão). O protocolo nunca muda e o UUID interno não é usado como
identificador principal. Se a análise terminar mas a gravação falhar, a API
responde `CONSULTATION_HISTORY_SAVE_FAILED` (nunca sucesso sem protocolo).

### Permissões

- **ADMIN**: vê todas as consultas, filtra por qualquer usuário e exporta CSV;
- **OPERATOR** e **TECHNICIAN**: veem todas e abrem detalhes (sem exportar);
- **VIEWER**: vê e abre somente as próprias consultas — tentar abrir uma
  consulta alheia (por UUID ou protocolo) responde `CONSULTATION_NOT_FOUND`,
  a mesma resposta de um registro inexistente, evitando enumeração.

Tudo é aplicado no backend; o frontend apenas esconde o que não se aplica.

### Endpoints

- `GET /api/consultations` — listagem paginada (`page`, `limit` ≤ 100, padrão
  20) com resumo por item (sem os JSONs detalhados) e filtros: `search`
  (protocolo, CEP, rua, número, bairro, cidade, nome do responsável),
  `protocol`, `status`, `userId`, `postalCode`, `city`, `state`, `dateFrom`,
  `dateTo` (datas `AAAA-MM-DD`, interpretadas como dias inteiros no fuso
  `CONSULTATION_TIME_ZONE` — padrão `America/Sao_Paulo`; os limites são
  convertidos para UTC apenas na consulta ao banco, e a exportação CSV usa a
  mesma regra),
  `hasCoverage`, `networkReferenceStatus`, `sortOrder`;
- `GET /api/consultations/:id` e `GET /api/consultations/protocol/:protocol` —
  detalhes completos (endereço informado/localizado, confiança, coordenadas,
  ajuste manual, snapshot de cobertura, referência pública do Voalle);
- `GET /api/consultations/export` — CSV, somente ADMIN, com rate limit
  próprio.

### Exportação CSV

UTF-8 **com BOM** (abre corretamente no Excel), separador ponto e vírgula,
aspas e quebras de linha escapadas e proteção contra **CSV injection**
(células iniciadas por `=`, `+`, `-`, `@`, tabulação ou CR recebem apóstrofo).
Respeita os mesmos filtros da listagem e o limite
`CONSULTATION_EXPORT_MAX_ROWS` (padrão 10000; acima disso responde
`CONSULTATION_EXPORT_LIMIT_EXCEEDED`). Nunca exporta tokens, chaves, caminhos
internos, `storedFileName`, SQL ou polígonos.

### Retenção e limpeza

`CONSULTATION_RETENTION_DAYS` (padrão 365) define a idade máxima dos
registros. A limpeza é **manual** (sem agendador e nunca na inicialização):

```bash
npm run consultations:cleanup -- --dry-run   # apenas conta o que removeria
npm run consultations:cleanup                # remove de fato, por lotes
```

Uma limpeza real gera o evento administrativo `CONSULTATION_CLEANUP_EXECUTED`
com contagens seguras.

### Códigos de erro

`CONSULTATION_NOT_FOUND`, `CONSULTATION_ACCESS_DENIED`,
`CONSULTATION_HISTORY_SAVE_FAILED`, `CONSULTATION_EXPORT_LIMIT_EXCEEDED`,
`CONSULTATION_INVALID_DATE_RANGE`, `CONSULTATION_INVALID_FILTER`,
`CONSULTATION_CLEANUP_FAILED`.

### Variáveis de ambiente novas

```
CONSULTATION_EXPORT_MAX_ROWS=10000
CONSULTATION_RETENTION_DAYS=365
CONSULTATION_TIME_ZONE=America/Sao_Paulo
LOCATION_CONFIRMATION_SECRET=<mínimo 32 caracteres>
```

### Confirmação de localização com token assinado

Sempre que uma requisição geocodifica um endereço (inclusive quando a
confirmação é apenas voluntária), a resposta traz `locationConfirmationToken`:
um token opaco, assinado com `LOCATION_CONFIRMATION_SECRET` (segredo próprio,
nunca o refresh token), com validade de 10 minutos e vinculado ao usuário
autenticado e ao hash do endereço normalizado. Ao confirmar/ajustar o marcador
o frontend envia esse token junto de `adjustedLocation`; o backend valida
assinatura, expiração, usuário e endereço — token ausente, adulterado,
expirado, de outro usuário ou de outro endereço responde
`LOCATION_CONFIRMATION_INVALID`. O registro histórico da confirmação preserva
a geocodificação ORIGINAL (endereço localizado, provider, confiança,
`locationType`, partialMatch e coordenadas geocodificadas) ao lado das
coordenadas confirmadas pelo usuário. O token nunca é gravado em banco,
histórico, auditoria ou logs, e fica apenas em memória no frontend. O
`locationType` do Google (ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER,
APPROXIMATE, UNKNOWN) agora é preservado de ponta a ponta e exibido nos
detalhes do histórico.

### Como testar

Backend (banco com nome claramente de teste; `deleteMany` nunca roda no banco
principal): `cd backend && npm test`. Frontend (mocks de API):
`cd frontend && npm test`. Os testes cobrem persistência por status,
imutabilidade do snapshot, RBAC por perfil, filtros, CSV (BOM, `;`, aspas,
formula injection), limite de exportação, auditoria e cleanup.
