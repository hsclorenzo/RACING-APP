-- =====================================================================
-- S1 RACING MOTORS — BANCO COMPLETO
-- Arquivo unico e IDEMPOTENTE. Rodar quantas vezes quiser: nada quebra,
-- nada apaga. Aplicado pela rota POST /api/migrations com a ADMIN_KEY.
--
-- CONVENCAO (vale para TODA tabela deste arquivo):
--   id uuid primary key default gen_random_uuid()
--   tenant_id uuid not null  -> multi-tenant desde a primeira linha
--   criado_em timestamptz default now()
--   atualizado_em timestamptz
--   RLS habilitada, sem excecao.
--
-- Nomes de tabela e coluna em portugues, sem acento.
-- =====================================================================

-- Sem `create extension pgcrypto`: gen_random_uuid() e nativa do Postgres
-- desde a versao 13, e o Neon roda 16+. Pedir a extensao so adicionaria um
-- ponto de falha em provedor gerenciado que restringe CREATE EXTENSION.

-- =====================================================================
-- 0. FUNDACAO MULTI-TENANT + RLS
-- =====================================================================

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text,
  telefone text,
  endereco text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  senha_hash text not null,
  nome text not null,
  telefone text,
  ativo boolean not null default true,
  ultimo_login timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);

-- Papel do usuario DENTRO de uma oficina. Um usuario pode, em tese,
-- pertencer a mais de uma (hoje so existe uma) — por isso a tabela
-- separada, e nao uma coluna papel em usuarios.
do $$ begin
  create type papel_usuario as enum ('admin', 'balcao', 'mecanico');
exception when duplicate_object then null; end $$;

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  usuario_id uuid not null references usuarios(id) on delete cascade,
  papel papel_usuario not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  unique (tenant_id, usuario_id)
);

create index if not exists idx_memberships_usuario on memberships(usuario_id);

-- ---------------------------------------------------------------------
-- O motor do RLS. Toda conexao emprestada do pool executa
-- set_config('app.usuario_id', ...) antes de qualquer query (ver
-- src/db/pool.js). Estas funcoes leem esse contexto.
--
-- app.bypass_rls = on e usado APENAS por rotina de sistema (migrations,
-- seed, login). Nunca por um handler de request ja autenticado.
-- ---------------------------------------------------------------------
create or replace function usuario_atual() returns uuid
language sql stable as $fn$
  select nullif(current_setting('app.usuario_id', true), '')::uuid
$fn$;

create or replace function bypass_rls() returns boolean
language sql stable as $fn$
  select coalesce(current_setting('app.bypass_rls', true), 'off') = 'on'
$fn$;

-- Os tenants que o usuario logado enxerga. security definer para que a
-- policy de memberships nao gere recursao infinita ao consultar
-- memberships.
create or replace function tenants_do_usuario() returns setof uuid
language sql stable security definer set search_path = public as $fn$
  select m.tenant_id from memberships m
   where m.usuario_id = usuario_atual() and m.ativo = true
$fn$;

-- Papel do usuario logado num tenant. Usado pelas policies de escrita.
create or replace function papel_no_tenant(p_tenant uuid) returns text
language sql stable security definer set search_path = public as $fn$
  select m.papel::text from memberships m
   where m.usuario_id = usuario_atual() and m.tenant_id = p_tenant and m.ativo = true
$fn$;

-- =====================================================================
-- 1. CADASTROS
-- =====================================================================

do $$ begin
  create type tipo_pessoa as enum ('pf', 'pj');
exception when duplicate_object then null; end $$;

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  tipo_pessoa tipo_pessoa not null default 'pf',
  documento text,
  telefone text,
  email text,
  endereco text,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_clientes_tenant on clientes(tenant_id);
create index if not exists idx_clientes_nome on clientes(tenant_id, lower(nome));

create table if not exists veiculos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete restrict,
  placa text not null,
  marca text,
  modelo text,
  ano int,
  cor text,
  chassi text,
  km_atual numeric(12,0),
  motorizacao text,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
-- Placa e unica POR OFICINA, nunca global. Normalizada: ABC-1234 e
-- abc1234 sao a mesma placa, senao o mesmo carro entra duas vezes.
create unique index if not exists uq_veiculos_placa
  on veiculos(tenant_id, upper(replace(placa, '-', '')));
create index if not exists idx_veiculos_cliente on veiculos(cliente_id);

create table if not exists fornecedores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  documento text,
  telefone text,
  contato text,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_fornecedores_tenant on fornecedores(tenant_id);

-- Catalogo de mao de obra. Contempla os dois modelos de cobranca:
-- por hora (tempo_padrao_horas x valor_hora) e valor fechado (valor_fixo).
-- Quando valor_fixo nao e nulo, ele vence.
create table if not exists servicos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  descricao text not null,
  tempo_padrao_horas numeric(8,2),
  valor_hora numeric(12,2),
  valor_fixo numeric(12,2),
  custo_hora numeric(12,2) not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_servicos_tenant on servicos(tenant_id);

-- ESTOQUE SEMPRE NA UNIDADE DE USO.
-- Compra em balde (unidade_compra), controla em litro (unidade_uso),
-- fator_conversao = 20. Entrada de 3 baldes credita 60 L.
-- custo_medio e SEMPRE por unidade_uso.
create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text,
  descricao text not null,
  categoria text,
  unidade_compra text not null default 'un',
  unidade_uso text not null default 'un',
  fator_conversao numeric(14,4) not null default 1,
  custo_medio numeric(14,4) not null default 0,
  preco_venda numeric(12,2) not null default 0,
  estoque_atual numeric(14,4) not null default 0,
  estoque_minimo numeric(14,4) not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  constraint ck_produtos_fator check (fator_conversao > 0)
);
create index if not exists idx_produtos_tenant on produtos(tenant_id);
create unique index if not exists uq_produtos_sku
  on produtos(tenant_id, upper(sku)) where sku is not null;

-- =====================================================================
-- 2. ORDEM DE SERVICO
-- =====================================================================

do $$ begin
  create type status_os as enum
    ('orcamento','aprovado','em_execucao','pronto','entregue','faturado','cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_item_os as enum ('servico','peca');
exception when duplicate_object then null; end $$;

create table if not exists ordens_servico (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  numero int not null,
  cliente_id uuid not null references clientes(id) on delete restrict,
  veiculo_id uuid not null references veiculos(id) on delete restrict,
  km_entrada numeric(12,0),
  status status_os not null default 'orcamento',
  mecanico_id uuid references usuarios(id) on delete set null,
  data_abertura timestamptz not null default now(),
  data_aprovacao timestamptz,
  data_conclusao timestamptz,
  data_entrega timestamptz,
  descricao_problema text,
  diagnostico text,
  total_servicos numeric(14,2) not null default 0,
  total_pecas numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  total_geral numeric(14,2) not null default 0,
  custo_total numeric(14,2) not null default 0,
  margem_valor numeric(14,2) not null default 0,
  margem_percentual numeric(8,2) not null default 0,
  baixa_confirmada boolean not null default false,
  fechada_em timestamptz,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
-- Sequencial POR OFICINA (nao global).
create unique index if not exists uq_os_numero on ordens_servico(tenant_id, numero);
create index if not exists idx_os_status on ordens_servico(tenant_id, status);
create index if not exists idx_os_veiculo on ordens_servico(veiculo_id);

-- Proximo numero de OS, atomico. O update com returning serializa duas
-- aberturas simultaneas em vez de gerar numero repetido.
create table if not exists os_sequencia (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  ultimo_numero int not null default 0
);

create or replace function proximo_numero_os(p_tenant uuid) returns int
language plpgsql as $fn$
declare v_num int;
begin
  insert into os_sequencia (tenant_id, ultimo_numero) values (p_tenant, 0)
    on conflict (tenant_id) do nothing;
  update os_sequencia set ultimo_numero = ultimo_numero + 1
    where tenant_id = p_tenant
    returning ultimo_numero into v_num;
  return v_num;
end $fn$;

-- custo_unitario e congelado no lancamento do item (custo_medio do produto
-- naquele instante). Nao e lido por referencia viva depois — mesma razao
-- do snapshot de taxa: relatorio de mes passado nao pode mudar sozinho.
create table if not exists os_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  os_id uuid not null references ordens_servico(id) on delete cascade,
  tipo tipo_item_os not null,
  servico_id uuid references servicos(id) on delete set null,
  produto_id uuid references produtos(id) on delete set null,
  descricao_livre text,
  quantidade numeric(14,4) not null default 1,
  custo_unitario numeric(14,4) not null default 0,
  preco_unitario numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  mecanico_id uuid references usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  constraint ck_os_itens_qtd check (quantidade > 0)
);
create index if not exists idx_os_itens_os on os_itens(os_id);

do $$ begin
  create type momento_foto as enum ('entrada','execucao','saida');
exception when duplicate_object then null; end $$;

-- arquivo guarda a CHAVE no Netlify Blobs, nao os bytes. Foto em bytea
-- estouraria o plano gratuito do Postgres em poucos meses.
create table if not exists os_fotos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  os_id uuid not null references ordens_servico(id) on delete cascade,
  momento momento_foto not null default 'entrada',
  arquivo text not null,
  legenda text,
  usuario_id uuid references usuarios(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists idx_os_fotos_os on os_fotos(os_id);

-- =====================================================================
-- 3. ESTOQUE
-- =====================================================================

do $$ begin
  create type tipo_movimento as enum ('entrada','saida','ajuste','estorno');
exception when duplicate_object then null; end $$;

create table if not exists compras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fornecedor_id uuid references fornecedores(id) on delete set null,
  numero_nota text,
  data date not null default current_date,
  valor_total numeric(14,2) not null default 0,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_compras_tenant on compras(tenant_id, data desc);

-- quantidade_compra e na UNIDADE DE COMPRA (3 baldes).
-- custo_unitario_uso e o custo por unidade de USO (R$/litro), ja dividido
-- pelo fator. Guardar os dois evita a conta ambigua depois.
create table if not exists compras_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  compra_id uuid not null references compras(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete restrict,
  quantidade_compra numeric(14,4) not null,
  unidade text,
  custo_total numeric(14,2) not null default 0,
  custo_unitario_uso numeric(14,4) not null default 0,
  criado_em timestamptz not null default now(),
  constraint ck_compras_itens_qtd check (quantidade_compra > 0)
);
create index if not exists idx_compras_itens_compra on compras_itens(compra_id);

-- quantidade e SEMPRE na unidade de uso e SEMPRE positiva. O sinal quem
-- da e o tipo. Guardar negativo em saida ja mordeu gente em somatorio.
create table if not exists movimentos_estoque (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  produto_id uuid not null references produtos(id) on delete restrict,
  tipo tipo_movimento not null,
  quantidade numeric(14,4) not null,
  custo_unitario numeric(14,4) not null default 0,
  estoque_depois numeric(14,4),
  custo_medio_depois numeric(14,4),
  os_id uuid references ordens_servico(id) on delete set null,
  compra_id uuid references compras(id) on delete set null,
  motivo text,
  usuario_id uuid references usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint ck_mov_qtd check (quantidade > 0)
);
create index if not exists idx_mov_produto on movimentos_estoque(produto_id, criado_em desc);
create index if not exists idx_mov_os on movimentos_estoque(os_id);

-- =====================================================================
-- 4. FINANCEIRO — O NUCLEO
-- =====================================================================

create table if not exists adquirentes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_adquirentes_tenant on adquirentes(tenant_id);

do $$ begin
  create type modalidade_pgto as enum
    ('debito','credito_vista','credito_parcelado','pix','dinheiro','transferencia');
exception when duplicate_object then null; end $$;

-- Faixa de parcelas: credito_parcelado 2..6 com 3,49%; 7..12 com 4,99%.
-- vigencia_fim nulo = taxa vigente hoje.
create table if not exists taxas_adquirente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  adquirente_id uuid references adquirentes(id) on delete cascade,
  modalidade modalidade_pgto not null,
  parcelas_min int not null default 1,
  parcelas_max int not null default 1,
  taxa_percentual numeric(8,4) not null default 0,
  taxa_fixa numeric(12,2) not null default 0,
  dias_liquidacao int not null default 0,
  vigencia_inicio date not null default current_date,
  vigencia_fim date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  constraint ck_taxas_faixa check (parcelas_max >= parcelas_min and parcelas_min >= 1)
);
create index if not exists idx_taxas_busca on taxas_adquirente
  (tenant_id, adquirente_id, modalidade, vigencia_inicio desc);

do $$ begin
  create type status_recebimento as enum ('previsto','liquidado','divergente');
exception when duplicate_object then null; end $$;

-- A DOR NUMERO UM DO SISTEMA MORA AQUI.
-- taxa_percentual_aplicada / taxa_fixa_aplicada sao SNAPSHOT: copiadas de
-- taxas_adquirente no momento do fechamento e nunca mais lidas por
-- referencia viva. Se a Stone renegociar a taxa amanha, o relatorio de
-- ontem continua igual. Sem isso o sistema perde credibilidade na
-- primeira renegociacao de contrato.
create table if not exists recebimentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  os_id uuid references ordens_servico(id) on delete cascade,
  adquirente_id uuid references adquirentes(id) on delete set null,
  modalidade modalidade_pgto not null,
  parcelas int not null default 1,
  valor_bruto numeric(14,2) not null,
  taxa_percentual_aplicada numeric(8,4) not null default 0,
  taxa_fixa_aplicada numeric(12,2) not null default 0,
  valor_taxa numeric(14,2) not null default 0,
  valor_liquido numeric(14,2) not null default 0,
  data_venda date not null default current_date,
  data_prevista_liquidacao date,
  data_liquidacao_real date,
  valor_liquidado_real numeric(14,2),
  status status_recebimento not null default 'previsto',
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_receb_os on recebimentos(os_id);
create index if not exists idx_receb_prev on recebimentos(tenant_id, data_prevista_liquidacao);

do $$ begin
  create type tipo_titulo as enum ('pagar','receber');
exception when duplicate_object then null; end $$;

do $$ begin
  create type origem_titulo as enum ('os','compra','despesa_fixa','avulso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_titulo as enum ('aberto','pago','cancelado');
exception when duplicate_object then null; end $$;

create table if not exists titulos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tipo tipo_titulo not null,
  origem origem_titulo not null default 'avulso',
  origem_id uuid,
  cliente_id uuid references clientes(id) on delete set null,
  fornecedor_id uuid references fornecedores(id) on delete set null,
  descricao text not null,
  valor numeric(14,2) not null,
  parcela_numero int not null default 1,
  parcela_total int not null default 1,
  vencimento date not null,
  pagamento date,
  status status_titulo not null default 'aberto',
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_titulos_venc on titulos(tenant_id, tipo, status, vencimento);
create index if not exists idx_titulos_origem on titulos(origem, origem_id);

create table if not exists despesas_fixas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  descricao text not null,
  valor numeric(14,2) not null,
  dia_vencimento int not null default 5,
  fornecedor_id uuid references fornecedores(id) on delete set null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  constraint ck_despesa_dia check (dia_vencimento between 1 and 28)
);
create index if not exists idx_despesas_tenant on despesas_fixas(tenant_id);

-- =====================================================================
-- 5. AUDITORIA
-- =====================================================================

create table if not exists auditoria (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  usuario_id uuid references usuarios(id) on delete set null,
  entidade text not null,
  entidade_id uuid,
  acao text not null,
  detalhe jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_auditoria_ent
  on auditoria(tenant_id, entidade, entidade_id, criado_em desc);

create table if not exists migrations_aplicadas (
  id serial primary key,
  nome text not null unique,
  aplicado_em timestamptz not null default now()
);

-- =====================================================================
-- 5.1 IMPOSTO E TAXA POR OPERACAO
-- =====================================================================
-- A tabela de taxas e SUGESTAO, nunca imposicao: cada venda pode ter a
-- sua. Adquirente renegocia caso a caso, antecipa uma venda e nao outra,
-- e o imposto muda com o regime e com o tipo do servico.
--
-- Por isso o recebimento grava as tres pernas separadas (taxa da
-- maquininha, taxa fixa, imposto) e `taxa_manual` diz se o numero veio
-- da tabela ou foi digitado na mao. Sem essa marca, mais tarde ninguem
-- consegue calcular media de taxa sem misturar o que foi excecao com o
-- que foi regra.

alter table taxas_adquirente
  add column if not exists imposto_percentual numeric(8,4) not null default 0;
alter table taxas_adquirente
  add column if not exists observacao text;

alter table recebimentos
  add column if not exists imposto_percentual_aplicado numeric(8,4) not null default 0;
alter table recebimentos
  add column if not exists valor_imposto numeric(14,2) not null default 0;
alter table recebimentos
  add column if not exists taxa_manual boolean not null default false;

-- =====================================================================
-- 5.2 FOTO DA OS
-- =====================================================================
-- A foto mora no PROPRIO banco (bytea), comprimida no celular antes de
-- subir (max 1280px, JPEG ~0,55 -> em torno de 100 KB).
--
-- Nao e a solucao definitiva e nao finge ser: 0,5 GB do Neon gratuito da
-- por volta de 5.000 fotos, o que numa oficina de ~60 OS por mes com 4
-- fotos cada dura uns 20 meses. Quando apertar, o caminho e mover o
-- conteudo para um armazenamento de arquivos e deixar `arquivo` como a
-- chave — a coluna ja existe justamente para isso, e nenhuma outra parte
-- do sistema le `conteudo` diretamente.
--
-- O que NAO se faz: guardar a foto em base64 dentro de uma coluna text.
-- Base64 infla 33% e ainda paga o custo de decodificar a cada leitura.
alter table os_fotos add column if not exists conteudo bytea;
alter table os_fotos add column if not exists tipo_mime text;
alter table os_fotos add column if not exists bytes int;
alter table os_fotos alter column arquivo drop not null;

-- =====================================================================
-- 6. RLS — HABILITADA EM TODAS AS TABELAS
-- =====================================================================
-- Padrao: isolamento por tenant via tenants_do_usuario(). bypass_rls()
-- so e ligado por rotina de sistema. usuarios e o unico caso especial (o
-- login precisa achar o usuario ANTES de existir contexto) e por isso e
-- lido com bypass, nunca por handler ja autenticado.

do $$
declare t text;
begin
  foreach t in array array[
    'clientes','veiculos','fornecedores','servicos','produtos',
    'ordens_servico','os_itens','os_fotos','os_sequencia',
    'compras','compras_itens','movimentos_estoque',
    'adquirentes','taxas_adquirente','recebimentos','titulos','despesas_fixas',
    'auditoria','memberships'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists p_tenant on %I', t);
  end loop;

  -- memberships: o usuario ve as proprias; admin ve as do tenant dele.
  execute $p$
    create policy p_tenant on memberships using (
      bypass_rls()
      or usuario_id = usuario_atual()
      or (tenant_id in (select tenants_do_usuario())
          and papel_no_tenant(tenant_id) = 'admin')
    ) with check (
      bypass_rls()
      or (tenant_id in (select tenants_do_usuario())
          and papel_no_tenant(tenant_id) = 'admin')
    )
  $p$;

  foreach t in array array[
    'clientes','veiculos','fornecedores','servicos','produtos',
    'ordens_servico','os_itens','os_fotos','os_sequencia',
    'compras','compras_itens','movimentos_estoque',
    'adquirentes','taxas_adquirente','recebimentos','titulos','despesas_fixas',
    'auditoria'
  ] loop
    execute format(
      'create policy p_tenant on %I
         using (bypass_rls() or tenant_id in (select tenants_do_usuario()))
         with check (bypass_rls() or tenant_id in (select tenants_do_usuario()))', t);
  end loop;
end $$;

alter table tenants enable row level security;
alter table tenants force row level security;
drop policy if exists p_tenant on tenants;
create policy p_tenant on tenants
  using (bypass_rls() or id in (select tenants_do_usuario()));

alter table usuarios enable row level security;
alter table usuarios force row level security;
drop policy if exists p_usuarios on usuarios;
-- Ve a si mesmo, ou quem divide oficina com voce.
create policy p_usuarios on usuarios using (
  bypass_rls()
  or id = usuario_atual()
  or exists (select 1 from memberships m
              where m.usuario_id = usuarios.id
                and m.tenant_id in (select tenants_do_usuario()))
);

insert into migrations_aplicadas (nome) values ('E1_fundacao')
  on conflict (nome) do nothing;
