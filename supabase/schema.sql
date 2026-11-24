-- =====================================================================
-- CEVISA — Spa Médico Adventista · Controle de alunos e financeiro
-- Schema do Supabase (PostgreSQL). Rode inteiro no SQL Editor do Supabase.
-- É seguro rodar mais de uma vez (idempotente na maior parte).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Gestores: quem está nesta tabela tem acesso total ao painel.
create table if not exists public.gestores (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nome       text,
  created_at timestamptz not null default now()
);

-- Aulas oferecidas (tela inicial). Vagas só são visíveis para gestores.
create table if not exists public.aulas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  descricao       text,
  foto_url        text,
  preco_mensal    numeric(10,2) check (preco_mensal    is null or preco_mensal    >= 0),
  preco_semestral numeric(10,2) check (preco_semestral is null or preco_semestral >= 0), -- valor TOTAL dos 6 meses
  preco_anual     numeric(10,2) check (preco_anual     is null or preco_anual     >= 0), -- valor TOTAL dos 12 meses
  vagas           integer not null default 20 check (vagas >= 0),
  ativa           boolean not null default true,   -- false = oculta da tela pública
  ordem           integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.alunos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  cpf             text,
  data_nascimento date,
  telefone        text,
  email           text,
  endereco        text,
  responsavel     text,          -- para bebês e crianças
  observacoes     text,
  ativo           boolean not null default true,  -- gestor ativa/desativa conforme pagamento
  created_at      timestamptz not null default now()
);

-- Matrícula = aluno inscrito em uma aula com um plano.
--  status 'ativa'     -> ocupa vaga
--  status 'espera'    -> lista de espera (ordem = created_at)
--  status 'encerrada' -> saiu / cancelou
-- data_fim = data até a qual o plano está PAGO (começa igual a data_inicio e
-- avança a cada pagamento e a cada mês trancado).
create table if not exists public.matriculas (
  id                uuid primary key default gen_random_uuid(),
  aluno_id          uuid not null references public.alunos(id) on delete cascade,
  aula_id           uuid not null references public.aulas(id)  on delete restrict,
  plano             text not null check (plano in ('mensal','semestral','anual')),
  status            text not null default 'ativa' check (status in ('ativa','espera','encerrada')),
  data_inicio       date not null default current_date,
  data_fim          date not null default current_date,
  data_encerramento date,
  created_at        timestamptz not null default now()
);
create index if not exists matriculas_aula_status_idx on public.matriculas (aula_id, status, created_at);
create index if not exists matriculas_aluno_idx       on public.matriculas (aluno_id);
-- um aluno não pode estar duas vezes (ativo/espera) na mesma aula
create unique index if not exists matriculas_unica_por_aula
  on public.matriculas (aluno_id, aula_id) where status in ('ativa','espera');

create table if not exists public.pagamentos (
  id           uuid primary key default gen_random_uuid(),
  matricula_id uuid not null references public.matriculas(id) on delete cascade,
  aluno_id     uuid not null references public.alunos(id) on delete cascade,
  plano        text not null check (plano in ('mensal','semestral','anual')),
  meses        integer not null check (meses > 0),     -- quantos meses este pagamento cobre
  competencia  date not null,                          -- 1º dia do mês de referência
  valor        numeric(10,2) not null check (valor >= 0),
  vencimento   date not null,
  status       text not null default 'pendente' check (status in ('pendente','pago')),
  pago_em      date,
  forma        text,                                   -- pix, dinheiro, cartão...
  created_at   timestamptz not null default now()
);
create index if not exists pagamentos_status_venc_idx on public.pagamentos (status, vencimento);
create index if not exists pagamentos_aluno_idx       on public.pagamentos (aluno_id);

-- Meses trancados (planos semestral e anual).
create table if not exists public.trancamentos (
  id           uuid primary key default gen_random_uuid(),
  matricula_id uuid not null references public.matriculas(id) on delete cascade,
  mes          date not null,                          -- 1º dia do mês trancado
  created_at   timestamptz not null default now(),
  unique (matricula_id, mes)
);

-- Notificações do gestor (vencimentos, vaga liberada...).
create table if not exists public.notificacoes (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null check (tipo in ('vence_em_breve','vencido','vaga_liberada')),
  aluno_id     uuid references public.alunos(id) on delete cascade,
  matricula_id uuid references public.matriculas(id) on delete cascade,
  referencia   date not null default current_date,
  mensagem     text not null,
  lida         boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (matricula_id, tipo, referencia)
);
create index if not exists notificacoes_lida_idx on public.notificacoes (lida, created_at desc);

-- ---------------------------------------------------------------------
-- Atualizações (seguras para bancos já existentes)
-- ---------------------------------------------------------------------

-- Horários de cada aula (texto livre, um horário por linha).
alter table public.aulas add column if not exists horarios text;

-- Idade mínima para se inscrever (ex.: musculação e hidroginástica a partir de 14 anos). Vazio = sem limite.
-- Na primeira vez que a coluna é criada, já preenche 14 anos para musculação e hidroginástica.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'aulas' and column_name = 'idade_minima') then
    alter table public.aulas add column idade_minima integer check (idade_minima is null or idade_minima between 1 and 120);
    update public.aulas set idade_minima = 14 where nome ilike '%muscula%' or nome ilike '%hidrogin%';
  end if;
end $$;

-- Acesso de alunos ao app: o usuário do Supabase Auth fica ligado ao cadastro
-- de aluno com o mesmo e-mail (confirmado). Um responsável pode ter vários alunos.
alter table public.alunos add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists alunos_user_idx  on public.alunos (user_id);
create index if not exists alunos_email_idx on public.alunos (lower(email));

-- Cadastro feito pelo admin (só e-mail): o aluno completa os dados no primeiro acesso.
-- Quem já existia continua como "completo".
alter table public.alunos add column if not exists cadastro_completo boolean not null default true;

-- Equipe: 'gestor' (principal) e 'admin' (mesmas permissões, mas não gerencia admins).
-- Quem já estava em gestores continua como gestor principal.
alter table public.gestores add column if not exists papel text not null default 'gestor';
alter table public.gestores add column if not exists email text;
alter table public.gestores drop constraint if exists gestores_papel_check;
alter table public.gestores add constraint gestores_papel_check check (papel in ('gestor','admin','professor'));

-- Professores: veem os alunos das aulas atribuídas a eles e podem cadastrar alunos novos.
-- NÃO têm acesso ao financeiro nem às fichas completas.
create table if not exists public.professor_aulas (
  user_id uuid not null references public.gestores(user_id) on delete cascade,
  aula_id uuid not null references public.aulas(id) on delete cascade,
  primary key (user_id, aula_id)
);
-- Quem cadastrou o aluno (para o professor ver os alunos que ele mesmo cadastrou).
alter table public.alunos add column if not exists criado_por uuid references auth.users(id) on delete set null;

-- O cadastro (ficha) é do RESPONSÁVEL: quem tem o login e paga.
-- Quem faz as aulas é o próprio responsável (participante_proprio) ou um dependente (participante_nome).
alter table public.alunos add column if not exists participante_proprio    boolean not null default true;
alter table public.alunos add column if not exists participante_nome       text;
alter table public.alunos add column if not exists participante_nascimento date;

-- Foto de perfil de quem faz as aulas (caminho no bucket privado "perfis": <id do aluno>/<arquivo>).
alter table public.alunos add column if not exists foto text;

-- Termo de uso e privacidade (LGPD): quando o responsável aceitou e qual versão do texto.
alter table public.alunos add column if not exists termo_aceito_em timestamptz;
alter table public.alunos add column if not exists termo_versao    text;
-- Questionário PAR-Q (prontidão para atividade física), obrigatório no cadastro.
-- parq = {"q1": false, ..., "q7": false}; sim em alguma = recomendar avaliação médica.
alter table public.alunos add column if not exists parq    jsonb;
alter table public.alunos add column if not exists parq_em timestamptz;

-- Vínculo com o Cevisa (define o preço): externo = preço normal; funcionario = aulas sem custo;
-- prestador = plano mensal de R$ 100,00 (semestral/anual com preço normal).
-- O responsável DECLARA no cadastro (vinculo_declarado) e a equipe CONFIRMA (vinculo) — só o confirmado vale.
-- Se as aulas forem de um DEPENDENTE, vale sempre o preço normal.
alter table public.alunos add column if not exists vinculo           text not null default 'externo';
alter table public.alunos add column if not exists vinculo_declarado text;
alter table public.alunos drop constraint if exists alunos_vinculo_check;
alter table public.alunos add constraint alunos_vinculo_check check (vinculo in ('externo','funcionario','prestador'));
alter table public.alunos drop constraint if exists alunos_vinculo_declarado_check;
alter table public.alunos add constraint alunos_vinculo_declarado_check
  check (vinculo_declarado is null or vinculo_declarado in ('externo','funcionario','prestador'));
alter table public.alunos drop column if exists funcionario;
alter table public.alunos drop column if exists funcionario_declarado;
drop function if exists public.declarar_funcionario(uuid);
drop function if exists public.definir_funcionario(uuid, boolean);

-- Nome de quem faz as aulas (o dependente, ou o próprio responsável).
create or replace function public._participante(a public.alunos)
returns text language sql immutable as $$
  select case when a.participante_proprio or nullif(trim(a.participante_nome), '') is null then a.nome
              else a.participante_nome end;
$$;

-- Admins convidados que ainda não criaram a senha (entram pelo "Primeiro acesso").
create table if not exists public.convites_admin (
  email      text primary key,           -- sempre em minúsculas
  nome       text,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Pedidos de inscrição feitos pelo aluno no app (o gestor/admin conclui a inscrição).
create table if not exists public.solicitacoes_inscricao (
  id           uuid primary key default gen_random_uuid(),
  aluno_id     uuid not null references public.alunos(id) on delete cascade,
  aula_id      uuid not null references public.aulas(id)  on delete cascade,
  plano        text not null check (plano in ('mensal','semestral','anual')),
  observacao   text,
  status       text not null default 'pendente' check (status in ('pendente','concluida','recusada')),
  resolvida_em timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists solicitacoes_uma_pendente
  on public.solicitacoes_inscricao (aluno_id, aula_id) where status = 'pendente';

-- Preço da diária (aula avulsa).
alter table public.aulas add column if not exists preco_diaria numeric(10,2) check (preco_diaria is null or preco_diaria >= 0);

-- Grupo de WhatsApp de cada aula: o aluno inscrito recebe o link numa janela no painel.
-- (só aparece para quem tem matrícula ativa; não sai na tela pública)
alter table public.aulas add column if not exists whatsapp_grupo text
  check (whatsapp_grupo is null or whatsapp_grupo ~* '^https://');
alter table public.matriculas add column if not exists grupo_visto boolean not null default false;

-- Link do grupo trocado: todos os inscritos recebem a janela de novo.
create or replace function public._tg_aulas_grupo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.whatsapp_grupo is distinct from old.whatsapp_grupo then
    update public.matriculas set grupo_visto = false where aula_id = new.id and grupo_visto;
  end if;
  return new;
end $$;
drop trigger if exists aulas_grupo on public.aulas;
create trigger aulas_grupo after update of whatsapp_grupo on public.aulas
  for each row execute function public._tg_aulas_grupo();

-- Turmas de cada aula: horários, características e vagas próprias.
-- Aula SEM turmas continua usando aulas.vagas; aula COM turmas usa as vagas de cada turma.
create table if not exists public.turmas (
  id         uuid primary key default gen_random_uuid(),
  aula_id    uuid not null references public.aulas(id) on delete cascade,
  nome       text not null,
  horarios   text,                 -- um horário por linha
  descricao  text,                 -- características: nível, faixa etária, professor...
  vagas      integer not null default 10 check (vagas >= 0),
  ativa      boolean not null default true,
  ordem      integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists turmas_aula_idx on public.turmas (aula_id, ordem);
alter table public.matriculas add column if not exists turma_id uuid references public.turmas(id) on delete set null;
create index if not exists matriculas_turma_idx on public.matriculas (turma_id, status, created_at);
alter table public.solicitacoes_inscricao add column if not exists turma_id uuid references public.turmas(id) on delete set null;

-- Grupo de WhatsApp próprio da turma (ex.: turma de um professor). Vazio = usa o grupo da aula.
alter table public.turmas add column if not exists whatsapp_grupo text
  check (whatsapp_grupo is null or whatsapp_grupo ~* '^https://');
create or replace function public._tg_turmas_grupo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.whatsapp_grupo is distinct from old.whatsapp_grupo then
    update public.matriculas set grupo_visto = false where turma_id = new.id and grupo_visto;
  end if;
  return new;
end $$;
drop trigger if exists turmas_grupo on public.turmas;
create trigger turmas_grupo after update of whatsapp_grupo on public.turmas
  for each row execute function public._tg_turmas_grupo();

-- Diárias (pagamentos avulsos lançados manualmente pela equipe).
create table if not exists public.diarias (
  id         uuid primary key default gen_random_uuid(),
  aula_id    uuid references public.aulas(id) on delete set null,   -- modalidade (opcional)
  valor      numeric(10,2) not null check (valor >= 0),
  forma      text not null,
  data       date not null default current_date,
  descricao  text,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists diarias_data_idx on public.diarias (data);

-- Reembolsos: dinheiro que a empresa DEVOLVEU (saída). Aluno é opcional. Abatem do total recebido nos relatórios.
create table if not exists public.reembolsos (
  id         uuid primary key default gen_random_uuid(),
  aluno_id   uuid references public.alunos(id) on delete set null,
  valor      numeric(10,2) not null check (valor > 0),
  data       date not null default current_date,
  observacao text,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists reembolsos_data_idx on public.reembolsos (data);

-- Comprovantes de pagamento enviados pelo aluno (arquivo no Storage, bucket "comprovantes").
create table if not exists public.comprovantes (
  id            uuid primary key default gen_random_uuid(),
  aluno_id      uuid not null references public.alunos(id) on delete cascade,
  arquivo       text not null,     -- caminho no bucket: <user_id>/<arquivo>
  nome_arquivo  text,
  observacao    text,
  email_enviado boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists comprovantes_aluno_idx on public.comprovantes (aluno_id, created_at desc);

-- Novos tipos de notificação: aluno avisou que pagou / pediu inscrição / enviou comprovante.
alter table public.notificacoes add column if not exists solicitacao_id uuid references public.solicitacoes_inscricao(id) on delete cascade;
alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check
  check (tipo in ('vence_em_breve','vencido','vaga_liberada','pagamento_informado','inscricao_solicitada','comprovante_enviado','vinculo_declarado','trancamento_solicitado','parq_alerta'));

-- Se o gestor trocar o e-mail do aluno, o acesso antigo deixa de valer.
create or replace function public._tg_alunos_email()
returns trigger language plpgsql as $$
begin
  if new.email is distinct from old.email then new.user_id := null; end if;
  return new;
end $$;
drop trigger if exists alunos_email_mudou on public.alunos;
create trigger alunos_email_mudou before update of email on public.alunos
  for each row execute function public._tg_alunos_email();

-- Notificações em tempo real para o gestor (banner de pagamento informado).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes') then
    alter publication supabase_realtime add table public.notificacoes;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Segurança (RLS)
-- ---------------------------------------------------------------------

create or replace function public.is_gestor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.gestores where user_id = auth.uid() and papel in ('gestor','admin'));
$$;

-- Professor: acesso restrito (lista de alunos das suas aulas + cadastro de alunos).
create or replace function public.is_professor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.gestores where user_id = auth.uid() and papel = 'professor');
$$;

-- Só o gestor principal (não os admins) pode gerenciar admins.
create or replace function public.is_gestor_principal()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.gestores where user_id = auth.uid() and papel = 'gestor');
$$;

alter table public.solicitacoes_inscricao enable row level security;
drop policy if exists solic_gestor on public.solicitacoes_inscricao;
create policy solic_gestor on public.solicitacoes_inscricao for all to authenticated
  using (public.is_gestor()) with check (public.is_gestor());
grant select, update on public.solicitacoes_inscricao to authenticated; -- aluno só usa as funções abaixo

alter table public.professor_aulas enable row level security;
drop policy if exists prof_aulas_ver on public.professor_aulas;
create policy prof_aulas_ver on public.professor_aulas for select to authenticated
  using (public.is_gestor() or user_id = auth.uid());
grant select on public.professor_aulas to authenticated;   -- alterações só pela função definir_aulas_professor
grant all on public.professor_aulas to service_role;

alter table public.turmas       enable row level security;
alter table public.diarias      enable row level security;
alter table public.comprovantes enable row level security;
drop policy if exists turmas_gestor on public.turmas;
create policy turmas_gestor on public.turmas for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists diarias_gestor on public.diarias;
create policy diarias_gestor on public.diarias for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists comprovantes_gestor on public.comprovantes;
create policy comprovantes_gestor on public.comprovantes for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
grant select, insert, update, delete on public.turmas, public.diarias to authenticated;
alter table public.reembolsos enable row level security;
drop policy if exists reembolsos_gestor on public.reembolsos;
create policy reembolsos_gestor on public.reembolsos for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
grant select, insert, update, delete on public.reembolsos to authenticated;
grant select, delete on public.comprovantes to authenticated;  -- o aluno envia pela função registrar_comprovante
grant all on public.comprovantes, public.pagamentos, public.matriculas, public.aulas to service_role;

alter table public.convites_admin enable row level security;
drop policy if exists convites_principal on public.convites_admin;
create policy convites_principal on public.convites_admin for select to authenticated using (public.is_gestor_principal());
-- Só leitura pela API (quem pode ver é decidido pela política acima);
-- criar/cancelar convites é feito pelas funções adicionar_admin / cancelar_convite_admin.
grant select on public.convites_admin to authenticated;

alter table public.gestores     enable row level security;
alter table public.aulas        enable row level security;
alter table public.alunos       enable row level security;
alter table public.matriculas   enable row level security;
alter table public.pagamentos   enable row level security;
alter table public.trancamentos enable row level security;
alter table public.notificacoes enable row level security;

drop policy if exists gestores_self   on public.gestores;
create policy gestores_self   on public.gestores     for select to authenticated using (user_id = auth.uid() or public.is_gestor());
drop policy if exists aulas_gestor    on public.aulas;
create policy aulas_gestor    on public.aulas        for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists alunos_gestor   on public.alunos;
create policy alunos_gestor   on public.alunos       for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists matr_gestor     on public.matriculas;
create policy matr_gestor     on public.matriculas   for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists pag_gestor      on public.pagamentos;
create policy pag_gestor      on public.pagamentos   for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists tranc_gestor    on public.trancamentos;
create policy tranc_gestor    on public.trancamentos for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists notif_gestor    on public.notificacoes;
create policy notif_gestor    on public.notificacoes for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- Visitantes veem as aulas SEM o número de vagas, apenas as ativas.
-- "lotada" diz só se há vaga (sem revelar quantas); vale para aulas sem turmas.
create or replace view public.aulas_publicas as
  select a.id, a.nome, a.descricao, a.foto_url, a.preco_mensal, a.preco_semestral, a.preco_anual, a.ordem, a.horarios,
         a.preco_diaria,
         ((select count(*) from public.matriculas m
            where m.aula_id = a.id and m.turma_id is null and m.status = 'ativa') >= a.vagas
          or exists (select 1 from public.matriculas m
                      where m.aula_id = a.id and m.turma_id is null and m.status = 'espera')) as lotada,
         a.idade_minima
  from public.aulas a
  where a.ativa
  order by a.ordem, a.nome;

-- Turmas visíveis aos alunos (sem o número de vagas).
create or replace view public.turmas_publicas as
  select t.id, t.aula_id, t.nome, t.horarios, t.descricao, t.ordem,
         ((select count(*) from public.matriculas m where m.turma_id = t.id and m.status = 'ativa') >= t.vagas
          or exists (select 1 from public.matriculas m where m.turma_id = t.id and m.status = 'espera')) as lotada
  from public.turmas t
  join public.aulas a on a.id = t.aula_id
  where t.ativa and a.ativa
  order by t.ordem, t.nome;

grant select on public.aulas_publicas  to anon, authenticated;
grant select on public.turmas_publicas to anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções internas (não expostas na API)
-- ---------------------------------------------------------------------

create or replace function public._meses_do_plano(p_plano text)
returns integer language sql immutable as $$
  select case p_plano when 'mensal' then 1 when 'semestral' then 6 when 'anual' then 12 end;
$$;

create or replace function public._preco_do_plano(p_aula uuid, p_plano text)
returns numeric language sql stable security definer set search_path = public as $$
  select case p_plano when 'mensal' then preco_mensal
                      when 'semestral' then preco_semestral
                      when 'anual' then preco_anual end
  from public.aulas where id = p_aula;
$$;

-- Vínculo que vale para o preço: dependente sempre paga o preço normal (externo).
create or replace function public._vinculo_preco(a public.alunos)
returns text language sql immutable as $$
  select case when a.participante_proprio then coalesce(a.vinculo, 'externo') else 'externo' end;
$$;

-- Preço do plano para um aluno, conforme o vínculo confirmado (null = plano sem preço definido).
create or replace function public._preco_aluno(p_aluno uuid, p_aula uuid, p_plano text)
returns numeric language sql stable security definer set search_path = public as $$
  select case when b.base is null then null
              when v.vinculo = 'funcionario' then 0
              when v.vinculo = 'prestador' and p_plano = 'mensal' then 100.00
              else round(b.base, 2) end
    from (select public._preco_do_plano(p_aula, p_plano) as base) b
    left join lateral (select public._vinculo_preco(a) as vinculo from public.alunos a where a.id = p_aluno) v on true;
$$;
revoke all on function public._preco_aluno(uuid, uuid, text) from public, anon, authenticated;

-- Desconto na matrícula ("Inscrever com desconto"): valor combinado que substitui o preço do plano
-- em TODAS as cobranças dessa matrícula, enquanto durar (o gestor pode mudar ou retirar na ficha).
alter table public.matriculas add column if not exists valor_personalizado numeric(10,2)
  check (valor_personalizado is null or valor_personalizado >= 0);
alter table public.matriculas add column if not exists desconto_motivo text;
alter table public.matriculas add column if not exists desconto_em     timestamptz;

-- Preço que vale para a matrícula: o desconto, se houver; senão o preço do plano conforme o vínculo.
create or replace function public._preco_matricula(p_matricula uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(m.valor_personalizado, public._preco_aluno(m.aluno_id, m.aula_id, m.plano))
    from public.matriculas m where m.id = p_matricula;
$$;
revoke all on function public._preco_matricula(uuid) from public, anon, authenticated;

-- Cobranças pendentes de valor ZERO de funcionário são quitadas automaticamente e renovam o plano.
create or replace function public._quitar_isentos(p_matricula uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.pagamentos;
begin
  for p in select pg.* from public.pagamentos pg join public.matriculas m on m.id = pg.matricula_id
            where pg.matricula_id = p_matricula and pg.status = 'pendente' and pg.valor = 0 and m.status = 'ativa'
              and public._preco_matricula(m.id) = 0
            for update of pg loop
    update public.pagamentos set status = 'pago', pago_em = current_date,
           forma = case when (select valor_personalizado from public.matriculas where id = p.matricula_id) is not null
                        then 'Isento (desconto)' else 'Isento (funcionário)' end
     where id = p.id;
    update public.matriculas set data_fim = (data_fim + make_interval(months => p.meses))::date where id = p.matricula_id;
    update public.notificacoes set lida = true
     where matricula_id = p.matricula_id and tipo in ('vence_em_breve','vencido');
  end loop;
end $$;
revoke all on function public._quitar_isentos(uuid) from public, anon, authenticated;

-- Cria a cobrança pendente de uma matrícula (se ainda não houver uma).
create or replace function public._criar_cobranca(p_matricula uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matriculas;
begin
  select * into m from public.matriculas where id = p_matricula;
  if not found or m.status <> 'ativa' then return; end if;
  if exists (select 1 from public.pagamentos where matricula_id = m.id and status = 'pendente') then return; end if;
  insert into public.pagamentos (matricula_id, aluno_id, plano, meses, competencia, valor, vencimento)
  values (m.id, m.aluno_id, m.plano, public._meses_do_plano(m.plano),
          date_trunc('month', m.data_fim)::date,
          coalesce(public._preco_matricula(m.id), 0),
          m.data_fim);
  -- funcionário (valor zero): não há o que cobrar — quita e renova o plano na hora
  perform public._quitar_isentos(m.id);
end $$;

-- Vagas de um "grupo": a turma (se houver) ou a aula inteira (matrículas sem turma).
create or replace function public._vagas_grupo(p_aula uuid, p_turma uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when p_turma is null then (select vagas from public.aulas  where id = p_aula)
              else                      (select vagas from public.turmas where id = p_turma) end;
$$;

-- Promove quem está na lista de espera enquanto houver vaga (ordem de reserva), turma a turma.
create or replace function public._promover_espera(p_aula uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g record; v_vagas int; v_ocupadas int; m public.matriculas; v_nome text; v_aula text; v_turma text;
begin
  select nome into v_aula from public.aulas where id = p_aula;
  for g in select distinct turma_id from public.matriculas where aula_id = p_aula and status = 'espera' loop
    v_vagas := coalesce(public._vagas_grupo(p_aula, g.turma_id), 0);
    v_turma := (select nome from public.turmas where id = g.turma_id);
    loop
      select count(*) into v_ocupadas from public.matriculas
       where aula_id = p_aula and turma_id is not distinct from g.turma_id and status = 'ativa';
      exit when v_ocupadas >= v_vagas;
      select * into m from public.matriculas
        where aula_id = p_aula and turma_id is not distinct from g.turma_id and status = 'espera'
        order by created_at, id limit 1 for update skip locked;
      exit when not found;
      update public.matriculas
         set status = 'ativa', data_inicio = current_date, data_fim = current_date
       where id = m.id;
      perform public._criar_cobranca(m.id);
      select nome into v_nome from public.alunos where id = m.aluno_id;
      insert into public.notificacoes (tipo, aluno_id, matricula_id, referencia, mensagem)
      values ('vaga_liberada', m.aluno_id, m.id, current_date,
              v_nome || ' saiu da lista de espera de ' || v_aula || coalesce(' (' || v_turma || ')', '')
              || ' e já tem vaga. Avise o aluno e registre o pagamento.')
      on conflict do nothing;
    end loop;
  end loop;
end $$;

create or replace function public._tg_aulas_vagas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.vagas > old.vagas then perform public._promover_espera(new.id); end if;
  return new;
end $$;
drop trigger if exists aulas_vagas_aumentaram on public.aulas;
create trigger aulas_vagas_aumentaram after update of vagas on public.aulas
  for each row execute function public._tg_aulas_vagas();

create or replace function public._tg_turmas_vagas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.vagas > old.vagas then perform public._promover_espera(new.aula_id); end if;
  return new;
end $$;
drop trigger if exists turmas_vagas_aumentaram on public.turmas;
create trigger turmas_vagas_aumentaram after update of vagas on public.turmas
  for each row execute function public._tg_turmas_vagas();

-- Não deixa excluir uma turma que ainda tem alunos (ativos ou na fila).
create or replace function public._tg_turmas_excluir()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.matriculas where turma_id = old.id and status in ('ativa','espera')) then
    raise exception 'Esta turma ainda tem alunos inscritos ou na lista de espera. Troque-os de turma ou desative a turma.';
  end if;
  return old;
end $$;
drop trigger if exists turmas_excluir on public.turmas;
create trigger turmas_excluir before delete on public.turmas
  for each row execute function public._tg_turmas_excluir();

-- Gera cobranças e notificações de vencimento (idempotente).
create or replace function public._atualizar_pendencias()
returns void language plpgsql security definer set search_path = public as $$
declare m record; v_msg text; v_plano text;
begin
  -- cobranças: plano que vence em até 7 dias (ou já venceu) e não tem cobrança pendente
  for m in select id from public.matriculas
            where status = 'ativa' and data_fim <= current_date + 7 loop
    perform public._criar_cobranca(m.id);
  end loop;

  for m in
    select mt.id, mt.aluno_id, mt.plano, mt.data_fim, a.nome as aluno, au.nome as aula
      from public.matriculas mt
      join public.alunos a  on a.id  = mt.aluno_id
      join public.aulas  au on au.id = mt.aula_id
     where mt.status = 'ativa' and mt.data_fim <= current_date + 7
  loop
    v_plano := m.plano;
    if m.data_fim < current_date then
      v_msg := 'Plano ' || v_plano || ' de ' || m.aluno || ' (' || m.aula || ') venceu em '
               || to_char(m.data_fim, 'DD/MM/YYYY') || '.';
      insert into public.notificacoes (tipo, aluno_id, matricula_id, referencia, mensagem)
      values ('vencido', m.aluno_id, m.id, m.data_fim, v_msg) on conflict do nothing;
    else
      v_msg := 'Plano ' || v_plano || ' de ' || m.aluno || ' (' || m.aula || ') vence em '
               || to_char(m.data_fim, 'DD/MM/YYYY') || '.';
      insert into public.notificacoes (tipo, aluno_id, matricula_id, referencia, mensagem)
      values ('vence_em_breve', m.aluno_id, m.id, m.data_fim, v_msg) on conflict do nothing;
    end if;
  end loop;
end $$;

revoke all on function public._criar_cobranca(uuid)    from public, anon, authenticated;
revoke all on function public._promover_espera(uuid)   from public, anon, authenticated;
revoke all on function public._atualizar_pendencias()  from public, anon, authenticated;
revoke all on function public._tg_aulas_vagas()        from public, anon, authenticated;
revoke all on function public._tg_turmas_vagas()       from public, anon, authenticated;
revoke all on function public._tg_turmas_excluir()     from public, anon, authenticated;
revoke all on function public._vagas_grupo(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções chamadas pelo app (RPC) — todas exigem gestor
-- ---------------------------------------------------------------------

create or replace function public.atualizar_pendencias()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  perform public._atualizar_pendencias();
end $$;

-- Data de nascimento de quem faz as aulas (o dependente, se a ficha for de um dependente).
create or replace function public._nascimento_participante(a public.alunos)
returns date language plpgsql immutable as $$
begin
  return case when a.participante_proprio = false and nullif(trim(a.participante_nome), '') is not null
              then a.participante_nascimento else a.data_nascimento end;
end $$;

-- Barra a inscrição de quem tem menos que a idade mínima da aula (sem data de nascimento: deixa passar).
create or replace function public._checar_idade(p_aluno uuid, p_aula uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_min int; v_aula text; v_nasc date; v_nome text;
begin
  select idade_minima, nome into v_min, v_aula from public.aulas where id = p_aula;
  if v_min is null then return; end if;
  select public._nascimento_participante(a), public._participante(a) into v_nasc, v_nome from public.alunos a where a.id = p_aluno;
  if v_nasc is not null and extract(year from age(current_date, v_nasc)) < v_min then
    raise exception '% não pode se inscrever em %: a idade mínima é % anos.', v_nome, v_aula, v_min;
  end if;
end $$;
revoke all on function public._checar_idade(uuid, uuid) from public, anon, authenticated;

-- Inscreve o aluno (numa turma, se a aula tiver turmas); se não houver vaga entra na lista de espera.
-- Retorna: { matricula_id, status, posicao_espera }
drop function if exists public.inscrever_aluno(uuid, uuid, text, date);
-- p_valor/p_motivo: "Inscrever com desconto" (valor combinado de cada cobrança e o motivo).
drop function if exists public.inscrever_aluno(uuid, uuid, text, date, uuid);
create or replace function public.inscrever_aluno(p_aluno uuid, p_aula uuid, p_plano text,
                                                  p_inicio date default current_date, p_turma uuid default null,
                                                  p_valor numeric default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vagas int; v_ocupadas int; v_id uuid; v_status text; v_pos int;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if p_plano not in ('mensal','semestral','anual') then raise exception 'Plano inválido.'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'Valor com desconto inválido.'; end if;
  if p_valor is not null and nullif(trim(p_motivo), '') is null then raise exception 'Informe o motivo do desconto.'; end if;

  perform 1 from public.aulas where id = p_aula and ativa for update;
  if not found then raise exception 'Aula não encontrada ou oculta.'; end if;
  if p_turma is null and exists (select 1 from public.turmas where aula_id = p_aula and ativa) then
    raise exception 'Escolha a turma.';
  end if;
  if p_turma is not null and not exists (select 1 from public.turmas where id = p_turma and aula_id = p_aula) then
    raise exception 'Turma não encontrada nesta aula.';
  end if;
  perform public._checar_idade(p_aluno, p_aula);

  if exists (select 1 from public.matriculas
              where aluno_id = p_aluno and aula_id = p_aula and status in ('ativa','espera')) then
    raise exception 'Este aluno já está inscrito (ou na lista de espera) nesta aula.';
  end if;

  v_vagas := coalesce(public._vagas_grupo(p_aula, p_turma), 0);
  select count(*) into v_ocupadas from public.matriculas
   where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'ativa';
  -- se já existe fila, quem chega agora entra no fim dela
  if v_ocupadas < v_vagas and not exists (select 1 from public.matriculas
       where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'espera') then
    v_status := 'ativa';
  else
    v_status := 'espera';
  end if;

  insert into public.matriculas (aluno_id, aula_id, turma_id, plano, status, data_inicio, data_fim,
                                 valor_personalizado, desconto_motivo, desconto_em)
  values (p_aluno, p_aula, p_turma, p_plano, v_status, coalesce(p_inicio, current_date), coalesce(p_inicio, current_date),
          round(p_valor, 2), case when p_valor is not null then left(trim(p_motivo), 300) end,
          case when p_valor is not null then now() end)
  returning id into v_id;

  -- conclui o pedido de inscrição feito pelo aluno no app (se houver)
  update public.notificacoes set lida = true
   where tipo = 'inscricao_solicitada'
     and solicitacao_id in (select id from public.solicitacoes_inscricao
                             where aluno_id = p_aluno and aula_id = p_aula and status = 'pendente');
  update public.solicitacoes_inscricao set status = 'concluida', resolvida_em = now()
   where aluno_id = p_aluno and aula_id = p_aula and status = 'pendente';

  if v_status = 'ativa' then
    perform public._criar_cobranca(v_id);
    v_pos := null;
  else
    select count(*) into v_pos from public.matriculas
     where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'espera'
       and (created_at, id) <= (select created_at, id from public.matriculas where id = v_id);
  end if;

  return jsonb_build_object('matricula_id', v_id, 'status', v_status, 'posicao_espera', v_pos);
end $$;

-- Troca o aluno de turma (dentro da mesma aula). Libera a vaga antiga para a fila.
create or replace function public.mudar_turma(p_matricula uuid, p_turma uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matriculas; v_ocupadas int;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into m from public.matriculas where id = p_matricula for update;
  if not found or m.status = 'encerrada' then raise exception 'Matrícula não encontrada.'; end if;
  if m.turma_id is not distinct from p_turma then return; end if;
  if p_turma is not null and not exists (select 1 from public.turmas where id = p_turma and aula_id = m.aula_id) then
    raise exception 'Turma não encontrada nesta aula.';
  end if;
  if m.status = 'ativa' then
    select count(*) into v_ocupadas from public.matriculas
     where aula_id = m.aula_id and turma_id is not distinct from p_turma and status = 'ativa';
    if v_ocupadas >= coalesce(public._vagas_grupo(m.aula_id, p_turma), 0) then
      raise exception 'A turma escolhida está cheia.';
    end if;
  end if;
  update public.matriculas set turma_id = p_turma where id = m.id;
  perform public._promover_espera(m.aula_id);
end $$;

revoke all on function public.mudar_turma(uuid, uuid) from public, anon;
grant execute on function public.mudar_turma(uuid, uuid) to authenticated;

-- Encerra a matrícula (libera a vaga e chama o próximo da fila).
create or replace function public.encerrar_matricula(p_matricula uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matriculas;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into m from public.matriculas where id = p_matricula for update;
  if not found then raise exception 'Matrícula não encontrada.'; end if;
  if m.status = 'encerrada' then return; end if;
  update public.matriculas set status = 'encerrada', data_encerramento = current_date where id = m.id;
  delete from public.pagamentos where matricula_id = m.id and status = 'pendente';
  perform public._promover_espera(m.aula_id);
end $$;

-- Registra o pagamento e estende a validade do plano.
create or replace function public.registrar_pagamento(p_pagamento uuid, p_forma text default null, p_data date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare p public.pagamentos;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into p from public.pagamentos where id = p_pagamento for update;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if p.status = 'pago' then raise exception 'Este pagamento já foi registrado.'; end if;

  update public.pagamentos
     set status = 'pago', pago_em = coalesce(p_data, current_date), forma = nullif(trim(p_forma), '')
   where id = p.id;
  update public.matriculas
     set data_fim = (data_fim + make_interval(months => p.meses))::date
   where id = p.matricula_id and status = 'ativa';
  update public.notificacoes set lida = true
   where matricula_id = p.matricula_id and tipo in ('vence_em_breve','vencido','vaga_liberada','inscricao_solicitada');
  update public.notificacoes set lida = true
   where aluno_id = p.aluno_id and tipo in ('pagamento_informado','comprovante_enviado');
end $$;

-- "Lançar mensalidade" (aba Cobranças): o aluno do plano mensal paga vários meses de uma vez.
-- Quita, em sequência, todos os meses desde o próximo em aberto até p_ate (do ano atual):
-- usa a cobrança pendente, se houver, e cria as demais já pagas. Cada mês estende o "pago até".
create or replace function public.lancar_mensalidades(p_matricula uuid, p_ate date, p_forma text default null, p_data date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare
  m public.matriculas; p public.pagamentos;
  v_ate date := date_trunc('month', p_ate)::date; v_comp date; v_qtd int := 0;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into m from public.matriculas where id = p_matricula for update;
  if not found or m.status <> 'ativa' then raise exception 'Matrícula ativa não encontrada.'; end if;
  if m.plano <> 'mensal' then raise exception 'Lançar mensalidade vale só para o plano mensal.'; end if;
  if v_ate > make_date(extract(year from current_date)::int, 12, 1) then
    raise exception 'Só é possível lançar meses do ano atual.';
  end if;
  if v_ate < date_trunc('month', m.data_fim)::date then
    raise exception 'Esses meses já estão pagos (pago até %).', to_char(m.data_fim, 'DD/MM/YYYY');
  end if;
  loop
    select * into m from public.matriculas where id = p_matricula;
    v_comp := date_trunc('month', m.data_fim)::date;
    exit when v_comp > v_ate;
    v_qtd := v_qtd + 1;
    if v_qtd > 24 then raise exception 'Quantidade de meses inválida.'; end if;
    select * into p from public.pagamentos
     where matricula_id = m.id and status = 'pendente' order by vencimento limit 1;
    if found then
      perform public.registrar_pagamento(p.id, p_forma, p_data);
    else
      insert into public.pagamentos (matricula_id, aluno_id, plano, meses, competencia, valor, vencimento, status, pago_em, forma)
      values (m.id, m.aluno_id, 'mensal', 1, v_comp,
              coalesce(public._preco_matricula(m.id), 0),
              m.data_fim, 'pago', coalesce(p_data, current_date), nullif(trim(p_forma), ''));
      update public.matriculas set data_fim = (data_fim + interval '1 month')::date where id = m.id;
    end if;
  end loop;
  return v_qtd;
end $$;
-- Confirmar o pagamento que o aluno informou ("Já paguei" / comprovante): dá baixa, de uma vez,
-- na próxima mensalidade de cada aula escolhida. Se a cobrança ainda não foi gerada, gera e quita.
create or replace function public.confirmar_pagamento_aluno(p_aluno uuid, p_matriculas uuid[], p_forma text default null, p_data date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare v_mat uuid; p public.pagamentos; v_qtd int := 0;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if coalesce(array_length(p_matriculas, 1), 0) = 0 then raise exception 'Escolha pelo menos uma aula.'; end if;
  foreach v_mat in array p_matriculas loop
    -- vale para as aulas do aluno e dos dependentes da mesma família (a cobrança é do responsável)
    if not exists (select 1 from public.matriculas where id = v_mat and status = 'ativa'
                    and aluno_id in (select public._familia(p_aluno))) then
      raise exception 'Matrícula não encontrada para este aluno.';
    end if;
    select * into p from public.pagamentos where matricula_id = v_mat and status = 'pendente' order by vencimento limit 1;
    if not found then
      perform public._criar_cobranca(v_mat);
      select * into p from public.pagamentos where matricula_id = v_mat and status = 'pendente' order by vencimento limit 1;
    end if;
    if found then
      perform public.registrar_pagamento(p.id, p_forma, p_data);
      v_qtd := v_qtd + 1;
    end if;
  end loop;
  update public.notificacoes set lida = true
   where aluno_id in (select public._familia(p_aluno)) and tipo in ('pagamento_informado','comprovante_enviado');
  return v_qtd;
end $$;
revoke all on function public.confirmar_pagamento_aluno(uuid, uuid[], text, date) from public, anon;
grant execute on function public.confirmar_pagamento_aluno(uuid, uuid[], text, date) to authenticated;

revoke all on function public.lancar_mensalidades(uuid, date, text, date) from public, anon;
grant execute on function public.lancar_mensalidades(uuid, date, text, date) to authenticated;

-- Tranca um mês (planos semestral/anual). O mês vai para o final do plano.
create or replace function public.trancar_mes(p_matricula uuid, p_mes date)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matriculas; v_mes date := date_trunc('month', p_mes)::date;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into m from public.matriculas where id = p_matricula for update;
  if not found or m.status <> 'ativa' then raise exception 'Matrícula ativa não encontrada.'; end if;
  if m.plano = 'mensal' then raise exception 'Só é possível trancar em planos semestral ou anual.'; end if;
  if v_mes <= date_trunc('month', current_date)::date then
    raise exception 'Só é possível trancar um mês que ainda não começou.';
  end if;
  if v_mes < date_trunc('month', m.data_inicio)::date or v_mes >= m.data_fim then
    raise exception 'Esse mês está fora do período pago do plano (até %).', to_char(m.data_fim, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.trancamentos where matricula_id = m.id and mes = v_mes) then
    raise exception 'Este mês já está trancado.';
  end if;
  insert into public.trancamentos (matricula_id, mes) values (m.id, v_mes);
  update public.matriculas set data_fim = (data_fim + interval '1 month')::date where id = m.id;
end $$;

-- Desfaz um trancamento (apenas se o mês ainda não começou).
create or replace function public.desfazer_trancamento(p_trancamento uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.trancamentos;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into t from public.trancamentos where id = p_trancamento for update;
  if not found then raise exception 'Trancamento não encontrado.'; end if;
  if t.mes <= date_trunc('month', current_date)::date then
    raise exception 'Esse mês já começou e não pode ser destrancado.';
  end if;
  delete from public.trancamentos where id = t.id;
  update public.matriculas set data_fim = (data_fim - interval '1 month')::date where id = t.matricula_id;
end $$;

-- ---------------------------------------------------------------------
-- Pedidos de trancamento feitos pelo ALUNO no app: sempre o PRÓXIMO mês, em qualquer dia.
-- A equipe aprova (o mês vai para o final do plano) ou recusa.
-- ---------------------------------------------------------------------
create table if not exists public.trancamento_pedidos (
  id            uuid primary key default gen_random_uuid(),
  matricula_id  uuid not null references public.matriculas(id) on delete cascade,
  aluno_id      uuid not null references public.alunos(id) on delete cascade,
  mes           date not null,                                   -- 1º dia do mês a trancar
  status        text not null default 'pendente' check (status in ('pendente','aprovado','recusado')),
  created_at    timestamptz not null default now(),
  resolvido_em  timestamptz,
  resolvido_por uuid references auth.users(id) on delete set null
);
create unique index if not exists trancamento_pedidos_um_pendente
  on public.trancamento_pedidos (matricula_id, mes) where status = 'pendente';
alter table public.trancamento_pedidos enable row level security;
drop policy if exists tranc_pedidos_gestor on public.trancamento_pedidos;
create policy tranc_pedidos_gestor on public.trancamento_pedidos for all to authenticated
  using (public.is_gestor()) with check (public.is_gestor());
grant select, insert, update, delete on public.trancamento_pedidos to authenticated;
grant all on public.trancamento_pedidos to service_role;

-- Tranca o mês sem a regra "ainda não começou" (usado na aprovação de um pedido feito antes do mês começar).
create or replace function public._trancar(p_matricula uuid, p_mes date)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matriculas; v_mes date := date_trunc('month', p_mes)::date;
begin
  select * into m from public.matriculas where id = p_matricula for update;
  if not found or m.status <> 'ativa' then raise exception 'Matrícula ativa não encontrada.'; end if;
  if m.plano = 'mensal' then raise exception 'Só é possível trancar em planos semestral ou anual.'; end if;
  if v_mes < date_trunc('month', m.data_inicio)::date or v_mes >= m.data_fim then
    raise exception 'Esse mês está fora do período pago do plano (até %).', to_char(m.data_fim, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.trancamentos where matricula_id = m.id and mes = v_mes) then
    raise exception 'Este mês já está trancado.';
  end if;
  insert into public.trancamentos (matricula_id, mes) values (m.id, v_mes);
  update public.matriculas set data_fim = (data_fim + interval '1 month')::date where id = m.id;
end $$;
revoke all on function public._trancar(uuid, date) from public, anon, authenticated;

-- O aluno pede para trancar o PRÓXIMO mês. A equipe recebe aviso no sino.
create or replace function public.solicitar_trancamento(p_matricula uuid)
returns date language plpgsql security definer set search_path = public as $$
declare m public.matriculas; a public.alunos; v_aula text;
        v_mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  select mt.* into m from public.matriculas mt join public.alunos al on al.id = mt.aluno_id
   where mt.id = p_matricula and al.user_id = auth.uid();
  if not found or m.status <> 'ativa' then raise exception 'Matrícula ativa não encontrada.'; end if;
  if m.plano = 'mensal' then raise exception 'O trancamento é só para os planos semestral e anual.'; end if;
  if v_mes >= m.data_fim then
    raise exception 'O próximo mês não está dentro do período pago do seu plano (até %). Fale com a recepção.', to_char(m.data_fim, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.trancamentos where matricula_id = m.id and mes = v_mes) then
    raise exception 'O próximo mês já está trancado.';
  end if;
  if exists (select 1 from public.trancamento_pedidos where matricula_id = m.id and mes = v_mes and status = 'pendente') then
    raise exception 'Você já pediu o trancamento do próximo mês. Aguarde a recepção aprovar.';
  end if;
  select * into a from public.alunos where id = m.aluno_id;
  select nome into v_aula from public.aulas where id = m.aula_id;
  insert into public.trancamento_pedidos (matricula_id, aluno_id, mes) values (m.id, m.aluno_id, v_mes);
  insert into public.notificacoes (tipo, aluno_id, matricula_id, referencia, mensagem)
  values ('trancamento_solicitado', m.aluno_id, m.id, v_mes,
          public._participante(a) || ' pediu para trancar ' || to_char(v_mes, 'MM/YYYY') || ' em ' || v_aula
          || '. Toque para aprovar ou recusar na ficha do aluno.')
  on conflict (matricula_id, tipo, referencia)
  do update set mensagem = excluded.mensagem, lida = false, created_at = now();
  return v_mes;
end $$;
revoke all on function public.solicitar_trancamento(uuid) from public, anon;
grant execute on function public.solicitar_trancamento(uuid) to authenticated;

-- A equipe aprova (tranca o mês e estende o plano) ou recusa o pedido.
create or replace function public.responder_trancamento(p_pedido uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p public.trancamento_pedidos;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into p from public.trancamento_pedidos where id = p_pedido for update;
  if not found or p.status <> 'pendente' then raise exception 'Pedido não encontrado ou já respondido.'; end if;
  if p_aprovar then perform public._trancar(p.matricula_id, p.mes); end if;
  update public.trancamento_pedidos
     set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         resolvido_em = now(), resolvido_por = auth.uid()
   where id = p.id;
  update public.notificacoes set lida = true
   where matricula_id = p.matricula_id and tipo = 'trancamento_solicitado' and referencia = p.mes;
end $$;
revoke all on function public.responder_trancamento(uuid, boolean) from public, anon;
grant execute on function public.responder_trancamento(uuid, boolean) to authenticated;

-- Exclui o aluno PERMANENTEMENTE: ficha, matrículas, pagamentos, trancamentos e notificações (cascade).
-- Libera as vagas (chamando a lista de espera) e apaga o login do aluno, se ele não for da equipe
-- e não tiver outras fichas (ex.: irmãos com o mesmo e-mail do responsável).
create or replace function public.excluir_aluno(p_aluno uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_aulas uuid[]; v_aula uuid;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select user_id into v_user from public.alunos where id = p_aluno for update;
  if not found then raise exception 'Aluno não encontrado.'; end if;
  select array_agg(distinct aula_id) into v_aulas
    from public.matriculas where aluno_id = p_aluno and status = 'ativa';

  delete from public.alunos where id = p_aluno;

  if v_aulas is not null then
    foreach v_aula in array v_aulas loop
      perform public._promover_espera(v_aula);
    end loop;
  end if;

  if v_user is not null
     and not exists (select 1 from public.gestores where user_id = v_user)
     and not exists (select 1 from public.alunos  where user_id = v_user) then
    delete from auth.users where id = v_user;
  end if;
end $$;

revoke all on function public.excluir_aluno(uuid) from public, anon;
grant execute on function public.excluir_aluno(uuid) to authenticated;

-- Exclui a aula MESMO com histórico: apaga junto as matrículas (ativas, na fila e encerradas),
-- os pagamentos, trancamentos e avisos ligados a elas. As diárias ficam (sem modalidade).
create or replace function public.excluir_aula(p_aula uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  perform 1 from public.aulas where id = p_aula for update;
  if not found then raise exception 'Aula não encontrada.'; end if;
  delete from public.matriculas where aula_id = p_aula;
  delete from public.aulas where id = p_aula;
end $$;
revoke all on function public.excluir_aula(uuid) from public, anon;
grant execute on function public.excluir_aula(uuid) to authenticated;

-- Relatório mensal.
create or replace function public.relatorio_mensal(p_ano int, p_mes int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month')::date;
  r jsonb;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select jsonb_build_object(
    'novos_alunos', (select count(*) from public.alunos
                      where (created_at at time zone 'America/Sao_Paulo')::date >= v_ini
                        and (created_at at time zone 'America/Sao_Paulo')::date <  v_fim),
    'planos', coalesce((select jsonb_agg(jsonb_build_object('plano', plano, 'qtd', qtd) order by plano)
                         from (select plano, count(*) qtd from public.matriculas
                                where (created_at at time zone 'America/Sao_Paulo')::date >= v_ini
                                  and (created_at at time zone 'America/Sao_Paulo')::date <  v_fim
                                  and status <> 'espera'
                                group by plano) x), '[]'::jsonb),
    'diarias',    coalesce((select sum(valor) from public.diarias where data >= v_ini and data < v_fim), 0),
    'diarias_lista', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', d.id, 'data', d.data, 'aula', au.nome, 'forma', d.forma, 'valor', d.valor,
                         'descricao', d.descricao) order by d.data, d.created_at)
                       from public.diarias d left join public.aulas au on au.id = d.aula_id
                       where d.data >= v_ini and d.data < v_fim), '[]'::jsonb),
    -- reembolsos (saídas): abatem do total recebido
    'reembolsos', coalesce((select sum(valor) from public.reembolsos where data >= v_ini and data < v_fim), 0),
    'reembolsos_lista', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', r.id, 'data', r.data, 'aluno_id', r.aluno_id,
                         'aluno', case when a.id is not null then public._participante(a) end,
                         'valor', r.valor, 'observacao', r.observacao) order by r.data, r.created_at)
                       from public.reembolsos r left join public.alunos a on a.id = r.aluno_id
                       where r.data >= v_ini and r.data < v_fim), '[]'::jsonb),
    -- Mesmo relatório, separado por modalidade (aula)
    'modalidades', coalesce((select jsonb_agg(x order by x->>'ordem_', x->>'aula') from (
        select jsonb_build_object(
          'aula_id', au.id, 'aula', au.nome, 'ordem_', lpad(au.ordem::text, 6, '0'),
          'alunos_ativos', (select count(*) from public.matriculas m where m.aula_id = au.id and m.status = 'ativa'),
          'na_espera',     (select count(*) from public.matriculas m where m.aula_id = au.id and m.status = 'espera'),
          'novas_matriculas', (select count(*) from public.matriculas m where m.aula_id = au.id and m.status <> 'espera'
                                 and (m.created_at at time zone 'America/Sao_Paulo')::date >= v_ini
                                 and (m.created_at at time zone 'America/Sao_Paulo')::date <  v_fim),
          -- valor inteiro no mês do pagamento (ver _entradas)
          'recebido',  coalesce((select sum(e.valor) from public._entradas(v_ini, v_fim) e join public.matriculas m on m.id = e.matricula_id
                                  where m.aula_id = au.id), 0),
          'pagamentos', (select count(*) from public._entradas(v_ini, v_fim) e join public.matriculas m on m.id = e.matricula_id
                                  where m.aula_id = au.id),
          'a_receber', coalesce((select sum(p.valor) from public.pagamentos p join public.matriculas m on m.id = p.matricula_id
                                  where m.aula_id = au.id and p.status = 'pendente' and p.vencimento >= v_ini and p.vencimento < v_fim), 0),
          'em_debito', coalesce((select sum(p.valor) from public.pagamentos p join public.matriculas m on m.id = p.matricula_id
                                  where m.aula_id = au.id and p.status = 'pendente' and p.vencimento >= v_ini and p.vencimento < v_fim
                                    and p.vencimento < current_date), 0),
          'diarias',   coalesce((select sum(d.valor) from public.diarias d where d.aula_id = au.id and d.data >= v_ini and d.data < v_fim), 0),
          'qtd_diarias', (select count(*) from public.diarias d where d.aula_id = au.id and d.data >= v_ini and d.data < v_fim)
        ) x
        from public.aulas au) s), '[]'::jsonb),
    'diarias_sem_modalidade', coalesce((select sum(valor) from public.diarias
                                         where aula_id is null and data >= v_ini and data < v_fim), 0),
    'recebido',   coalesce((select sum(valor) from public._entradas(v_ini, v_fim)), 0),
    'a_receber',  coalesce((select sum(valor) from public.pagamentos
                             where status = 'pendente' and vencimento >= v_ini and vencimento < v_fim), 0),
    'recebimentos', coalesce((select jsonb_agg(jsonb_build_object(
                         'pagamento_id', e.pagamento_id, 'aluno_id', e.aluno_id, 'aluno', a.nome, 'plano', e.plano,
                         'valor', e.valor, 'pago_em', e.data, 'forma', e.forma,
                         'parcela', e.parcela, 'parcelas', e.parcelas, 'valor_total', e.valor_total) order by e.data, a.nome)
                       from public._entradas(v_ini, v_fim) e join public.alunos a on a.id = e.aluno_id), '[]'::jsonb),
    'em_debito',  coalesce((select jsonb_agg(jsonb_build_object(
                         'pagamento_id', p.id, 'aluno_id', p.aluno_id, 'aluno', a.nome, 'telefone', a.telefone,
                         'plano', p.plano, 'valor', p.valor, 'vencimento', p.vencimento,
                         'dias_atraso', (current_date - p.vencimento)) order by p.vencimento, a.nome)
                       from public.pagamentos p join public.alunos a on a.id = p.aluno_id
                       where p.status = 'pendente' and p.vencimento >= v_ini and p.vencimento < v_fim
                         and p.vencimento < current_date), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke all on function public.atualizar_pendencias()                        from public, anon;
revoke all on function public.inscrever_aluno(uuid, uuid, text, date, uuid, numeric, text) from public, anon;
revoke all on function public.encerrar_matricula(uuid)                      from public, anon;
revoke all on function public.registrar_pagamento(uuid, text, date)         from public, anon;
revoke all on function public.trancar_mes(uuid, date)                       from public, anon;
revoke all on function public.desfazer_trancamento(uuid)                    from public, anon;
revoke all on function public.relatorio_mensal(int, int)                    from public, anon;
grant execute on function public.atualizar_pendencias()                     to authenticated;
grant execute on function public.inscrever_aluno(uuid, uuid, text, date, uuid, numeric, text) to authenticated;
grant execute on function public.encerrar_matricula(uuid)                   to authenticated;
grant execute on function public.registrar_pagamento(uuid, text, date)      to authenticated;
grant execute on function public.trancar_mes(uuid, date)                    to authenticated;
grant execute on function public.desfazer_trancamento(uuid)                 to authenticated;
grant execute on function public.relatorio_mensal(int, int)                 to authenticated;

-- ---------------------------------------------------------------------
-- Funções do ALUNO (cada aluno só enxerga os próprios dados)
-- ---------------------------------------------------------------------

-- Liga o usuário logado aos cadastros de aluno com o mesmo e-mail.
-- Só vale para e-mail CONFIRMADO (impede alguém de se passar por outro aluno).
-- Retorna quantos cadastros de aluno este usuário acessa.
create or replace function public.vincular_aluno()
returns integer language plpgsql security definer set search_path = public as $$
declare v_email text; v_conf timestamptz; v_qtd int;
begin
  if auth.uid() is null then return 0; end if;
  select email, email_confirmed_at into v_email, v_conf from auth.users where id = auth.uid();
  if v_email is not null and v_conf is not null then
    update public.alunos set user_id = auth.uid()
     where user_id is null and lower(trim(email)) = lower(v_email);
  end if;
  select count(*) into v_qtd from public.alunos where user_id = auth.uid();
  return v_qtd;
end $$;

-- Dados do painel do aluno: aulas, horários, valores e vencimentos.
create or replace function public.painel_aluno()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'nome', a.nome, 'participante', public._participante(a), 'foto', a.foto, 'vinculo', public._vinculo_preco(a),
           'dependente', a.responsavel_id is not null, 'parentesco', a.parentesco, 'nascimento', public._nascimento_participante(a), 'vinculo_declarado', a.vinculo_declarado, 'ativo', a.ativo, 'cadastro_completo', a.cadastro_completo,
           'matriculas', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'id', m.id, 'aula_id', m.aula_id, 'status', m.status, 'plano', m.plano,
                       'data_inicio', m.data_inicio, 'data_fim', m.data_fim,
                       'aula', au.nome, 'horarios', coalesce(t.horarios, au.horarios),
                       'turma_id', m.turma_id, 'turma', t.nome,
                       -- reserva de vaga: inscrito, mas nenhum pagamento registrado ainda (grupo só depois de pagar)
                       'reserva', m.status = 'ativa' and not exists (select 1 from public.pagamentos pg
                                                                      where pg.matricula_id = m.id and pg.status = 'pago'),
                       'grupo', case when m.status = 'ativa' and exists (select 1 from public.pagamentos pg
                                                                          where pg.matricula_id = m.id and pg.status = 'pago')
                                     then coalesce(t.whatsapp_grupo, au.whatsapp_grupo) end, 'grupo_visto', m.grupo_visto,
                       'trancados', coalesce((select jsonb_agg(tr.mes order by tr.mes) from public.trancamentos tr where tr.matricula_id = m.id), '[]'::jsonb),
                       'tranc_pedido', (select jsonb_build_object('mes', tp.mes, 'status', tp.status) from public.trancamento_pedidos tp
                                         where tp.matricula_id = m.id and tp.mes >= date_trunc('month', current_date)::date
                                         order by tp.created_at desc limit 1),
                       'preco', public._preco_matricula(m.id),
                       'pendente', (select jsonb_build_object('id', p.id, 'valor', p.valor, 'vencimento', p.vencimento)
                                      from public.pagamentos p
                                     where p.matricula_id = m.id and p.status = 'pendente'
                                     order by p.vencimento limit 1)
                     ) order by au.ordem, au.nome)
                from public.matriculas m join public.aulas au on au.id = m.aula_id
                left join public.turmas t on t.id = m.turma_id
               where m.aluno_id = a.id and m.status in ('ativa','espera')), '[]'::jsonb),
           'solicitacoes', coalesce((
              select jsonb_agg(jsonb_build_object('id', s.id, 'aula_id', s.aula_id, 'aula', au.nome, 'turma', t.nome,
                                                  'plano', s.plano, 'created_at', s.created_at) order by s.created_at)
                from public.solicitacoes_inscricao s join public.aulas au on au.id = s.aula_id
                left join public.turmas t on t.id = s.turma_id
               where s.aluno_id = a.id and s.status = 'pendente'), '[]'::jsonb),
           'ultimo_pagamento', (select max(pago_em) from public.pagamentos where aluno_id = a.id and status = 'pago'),
           'pagamento_informado_em', (select max(created_at) from public.notificacoes
                                       where aluno_id = a.id and tipo = 'pagamento_informado')
         ) order by a.nome), '[]'::jsonb)
    into r
    from public.alunos a
   where a.user_id = auth.uid();
  return r;
end $$;

-- Aluno avisa que pagou: gera uma notificação (banner) para o gestor.
create or replace function public.informar_pagamento(p_forma text default null, p_obs text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a record; v_total numeric; v_venc date; v_msg text; v_qtd int := 0;
  v_forma text := left(nullif(trim(p_forma), ''), 40);
  v_obs   text := left(nullif(trim(p_obs), ''), 300);
  -- família (responsável com dependentes): um aviso só, com o total de todos
  v_soma numeric := 0; v_min date; v_nomes text[] := '{}'; v_resp text; v_primeiro uuid;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if exists (select 1 from public.notificacoes n join public.alunos al on al.id = n.aluno_id
              where al.user_id = auth.uid() and n.tipo = 'pagamento_informado'
                and n.created_at > now() - interval '10 minutes') then
    raise exception 'Você já avisou o pagamento há poucos minutos. O gestor já foi notificado.';
  end if;
  for a in select al.id, al.nome, public._participante(al) as quem from public.alunos al
            where al.user_id = auth.uid() order by al.participante_proprio desc, al.created_at loop
    select sum(coalesce(p.valor, public._preco_matricula(m.id), 0)),
           min(coalesce(p.vencimento, m.data_fim))
      into v_total, v_venc
      from public.matriculas m
      left join public.pagamentos p on p.matricula_id = m.id and p.status = 'pendente'
     where m.aluno_id = a.id and m.status = 'ativa';
    continue when v_venc is null;
    v_soma := v_soma + coalesce(v_total, 0);
    v_min := least(coalesce(v_min, v_venc), v_venc);
    v_nomes := v_nomes || a.quem;
    v_resp := coalesce(v_resp, a.nome);
    v_primeiro := coalesce(v_primeiro, a.id);
    v_qtd := v_qtd + 1;
  end loop;
  if v_qtd = 0 then raise exception 'Você não tem mensalidades ativas para informar.'; end if;
  v_msg := v_resp || ' informou que pagou a(s) mensalidade(s)'
           || case when v_qtd > 1 or v_nomes[1] <> v_resp then ' de ' || array_to_string(v_nomes, ', ') else '' end
           || ': R$ ' || replace(to_char(v_soma, 'FM999999990.00'), '.', ',')
           || ' (vencimento ' || to_char(v_min, 'DD/MM/YYYY') || ').'
           || coalesce(' Forma: ' || v_forma || '.', '')
           || coalesce(' Obs.: ' || v_obs, '');
  insert into public.notificacoes (tipo, aluno_id, referencia, mensagem)
  values ('pagamento_informado', v_primeiro, current_date, v_msg);
  return v_qtd;
end $$;

-- ---------------------------------------------------------------------
-- Admins (somente o gestor principal adiciona/remove)
-- ---------------------------------------------------------------------

-- Adiciona um admin pelo e-mail. Se a pessoa ainda não tem conta, fica como convite
-- e vira admin quando criar a senha em "Primeiro acesso" e confirmar o e-mail.
-- Retorna 'ativo' ou 'convidado'.
create or replace function public.adicionar_admin(p_email text, p_nome text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_user uuid; v_conf timestamptz;
begin
  if not public.is_gestor_principal() then raise exception 'Apenas o gestor principal pode adicionar admins.'; end if;
  if v_email is null or v_email !~ '^\S+@\S+\.\S+$' then raise exception 'E-mail inválido.'; end if;
  select id, email_confirmed_at into v_user, v_conf from auth.users where lower(email) = v_email;
  if v_user is not null and exists (select 1 from public.gestores where user_id = v_user) then
    raise exception 'Este e-mail já faz parte da equipe.';
  end if;
  if v_user is not null and v_conf is not null then
    insert into public.gestores (user_id, nome, papel, email) values (v_user, nullif(trim(p_nome), ''), 'admin', v_email);
    delete from public.convites_admin where email = v_email;
    return 'ativo';
  end if;
  insert into public.convites_admin (email, nome, criado_por) values (v_email, nullif(trim(p_nome), ''), auth.uid())
  on conflict (email) do update set nome = excluded.nome;
  return 'convidado';
end $$;

-- Remove um membro da equipe (nunca o gestor principal).
-- Gestor principal remove admins e professores; admins removem só professores.
create or replace function public.remover_admin(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_gestor_principal() then
    delete from public.gestores where user_id = p_user and papel in ('admin','professor');
  elsif public.is_gestor() then
    delete from public.gestores where user_id = p_user and papel = 'professor';
  else
    raise exception 'Acesso negado.';
  end if;
  if not found then raise exception 'Membro da equipe não encontrado (admins só podem remover professores).'; end if;
end $$;

-- Define em quais aulas (modalidades) o professor dá aula (gestor ou admin).
create or replace function public.definir_aulas_professor(p_user uuid, p_aulas uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if not exists (select 1 from public.gestores where user_id = p_user and papel = 'professor') then
    raise exception 'Professor não encontrado.';
  end if;
  delete from public.professor_aulas where user_id = p_user;
  insert into public.professor_aulas (user_id, aula_id)
  select p_user, a.id from public.aulas a where a.id = any(coalesce(p_aulas, '{}'));
end $$;

-- Painel do professor: alunos (inscritos e lista de espera) das aulas dele, por turma.
-- Só dados de contato; nada financeiro.
create or replace function public.professor_painel()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_professor() then raise exception 'Acesso negado.'; end if;
  return jsonb_build_object(
    'aulas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', au.id, 'nome', au.nome, 'vagas', au.vagas, 'horarios', au.horarios,
        'turmas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.nome, 'horarios', t.horarios, 'vagas', t.vagas)
                                              order by t.ordem, t.nome)
                              from public.turmas t where t.aula_id = au.id and t.ativa), '[]'::jsonb),
        'alunos', coalesce((select jsonb_agg(jsonb_build_object(
                                     'nome', public._participante(a),
                                     'responsavel', case when public._participante(a) <> a.nome then a.nome else a.responsavel end,
                                     'nascimento', case when public._participante(a) <> a.nome then a.participante_nascimento
                                                        else a.data_nascimento end,
                                     'telefone', a.telefone, 'foto', a.foto, 'status', m.status, 'turma_id', m.turma_id,
                                     'desde', m.data_inicio)
                                   order by m.status, case when m.status = 'espera' then m.created_at end, public._participante(a))
                              from public.matriculas m join public.alunos a on a.id = m.aluno_id
                             where m.aula_id = au.id and m.status in ('ativa','espera')), '[]'::jsonb)
      ) order by au.ordem, au.nome)
      from public.aulas au join public.professor_aulas pa on pa.aula_id = au.id and pa.user_id = auth.uid()), '[]'::jsonb),
    'cadastrados', coalesce((
      select jsonb_agg(jsonb_build_object('nome', x.nome, 'email', x.email, 'cadastro_completo', x.cadastro_completo,
                                          'created_at', x.created_at) order by x.created_at desc)
      from (select nome, email, cadastro_completo, created_at from public.alunos
             where criado_por = auth.uid() order by created_at desc limit 30) x), '[]'::jsonb)
  );
end $$;

revoke all on function public.definir_aulas_professor(uuid, uuid[]) from public, anon;
revoke all on function public.professor_painel()                    from public, anon;
grant execute on function public.definir_aulas_professor(uuid, uuid[]) to authenticated;
grant execute on function public.professor_painel()                    to authenticated;

create or replace function public.cancelar_convite_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor_principal() then raise exception 'Acesso negado.'; end if;
  delete from public.convites_admin where email = lower(trim(p_email));
end $$;

-- Chamado no login: se houver convite para o e-mail (confirmado), vira admin.
create or replace function public.aceitar_convite_admin()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_email text; v_conf timestamptz; c public.convites_admin;
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.gestores where user_id = auth.uid()) then return true; end if;
  select lower(email), email_confirmed_at into v_email, v_conf from auth.users where id = auth.uid();
  if v_email is null or v_conf is null then return false; end if;
  select * into c from public.convites_admin where email = v_email;
  if not found then return false; end if;
  insert into public.gestores (user_id, nome, papel, email) values (auth.uid(), c.nome, 'admin', v_email);
  delete from public.convites_admin where email = v_email;
  return true;
end $$;

revoke all on function public.adicionar_admin(text, text)        from public, anon;
revoke all on function public.remover_admin(uuid)                from public, anon;
revoke all on function public.cancelar_convite_admin(text)       from public, anon;
revoke all on function public.aceitar_convite_admin()            from public, anon;
grant execute on function public.adicionar_admin(text, text)     to authenticated;
grant execute on function public.remover_admin(uuid)             to authenticated;
grant execute on function public.cancelar_convite_admin(text)    to authenticated;
grant execute on function public.aceitar_convite_admin()         to authenticated;

-- ---------------------------------------------------------------------
-- Cadastro pelo admin + primeiro acesso do aluno
-- (as contas são criadas pela Edge Function "criar-usuario", com a chave de serviço)
-- ---------------------------------------------------------------------

-- Cadastros do aluno logado que ainda precisam ser completados.
-- Fichas que o aluno ainda precisa completar: cadastro incompleto, sem foto de perfil
-- ou sem o termo de privacidade aceito. so_complemento = já tem os dados (cadastros antigos):
-- pede só o que falta (precisa_foto / precisa_termo).
create or replace function public.aluno_cadastro_pendente()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'email', a.email, 'nome', a.nome, 'participante', public._participante(a),
           'so_complemento', a.cadastro_completo,
           'precisa_foto', a.foto is null, 'precisa_termo', a.termo_aceito_em is null,
           'precisa_parq', a.parq_em is null) order by a.created_at), '[]'::jsonb)
    from public.alunos a
   where a.user_id = auth.uid() and (not a.cadastro_completo or a.foto is null or a.termo_aceito_em is null or a.parq_em is null);
$$;

-- O responsável informa no cadastro o vínculo (externo, funcionário ou prestador).
-- Funcionário/prestador gera aviso para a equipe confirmar; até lá vale o preço normal.
create or replace function public.declarar_vinculo(p_aluno uuid, p_vinculo text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.alunos;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if p_vinculo is null or p_vinculo not in ('externo','funcionario','prestador') then
    raise exception 'Marque se você é externo, funcionário ou prestador.';
  end if;
  update public.alunos set vinculo_declarado = p_vinculo
   where id = p_aluno and user_id = auth.uid()
  returning * into a;
  if not found then raise exception 'Cadastro não encontrado.'; end if;
  if p_vinculo = 'externo' or a.vinculo = p_vinculo or not a.participante_proprio then return; end if;
  insert into public.notificacoes (tipo, aluno_id, referencia, mensagem)
  values ('vinculo_declarado', p_aluno, current_date,
          a.nome || ' informou no cadastro que é '
          || case p_vinculo when 'funcionario' then 'funcionário(a) — aulas sem custo'
                            else 'prestador(a) de serviço — plano mensal de R$ 100,00' end
          || '. Confirme na ficha para o preço passar a valer.')
  on conflict (matricula_id, tipo, referencia) do update
     set mensagem = excluded.mensagem, lida = false, created_at = now();
end $$;
revoke all on function public.declarar_vinculo(uuid, text) from public, anon;
grant execute on function public.declarar_vinculo(uuid, text) to authenticated;

-- A equipe confirma (ou muda) o vínculo. As cobranças PENDENTES do aluno são recalculadas na hora
-- (as de valor zero, de funcionário, são quitadas e o plano renovado).
create or replace function public.definir_vinculo(p_aluno uuid, p_vinculo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_mat uuid;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if p_vinculo is null or p_vinculo not in ('externo','funcionario','prestador') then raise exception 'Vínculo inválido.'; end if;
  update public.alunos set vinculo = p_vinculo, vinculo_declarado = p_vinculo where id = p_aluno;
  if not found then raise exception 'Aluno não encontrado.'; end if;
  update public.pagamentos p
     set valor = coalesce(public._preco_matricula(m.id), p.valor)
    from public.matriculas m
   where m.id = p.matricula_id and p.aluno_id = p_aluno and p.status = 'pendente';
  for v_mat in select id from public.matriculas where aluno_id = p_aluno and status = 'ativa' loop
    perform public._quitar_isentos(v_mat);
  end loop;
  update public.notificacoes set lida = true where aluno_id = p_aluno and tipo = 'vinculo_declarado';
end $$;
revoke all on function public.definir_vinculo(uuid, text) from public, anon;
grant execute on function public.definir_vinculo(uuid, text) to authenticated;

-- O responsável aceita o termo de uso e privacidade (LGPD) da ficha.
create or replace function public.aceitar_termo(p_aluno uuid, p_versao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  update public.alunos set termo_aceito_em = now(), termo_versao = left(nullif(trim(p_versao), ''), 20)
   where id = p_aluno and user_id = auth.uid();
  if not found then raise exception 'Cadastro não encontrado.'; end if;
end $$;
revoke all on function public.aceitar_termo(uuid, text) from public, anon;
grant execute on function public.aceitar_termo(uuid, text) to authenticated;

-- Questionário PAR-Q respondido pelo responsável (sobre quem vai fazer as aulas).
-- Resposta "sim" em alguma pergunta avisa a equipe no sino (pedir liberação médica).
create or replace function public.responder_parq(p_aluno uuid, p_respostas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a public.alunos; v_sim int := 0; i int; v_r jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  for i in 1..7 loop
    if jsonb_typeof(p_respostas -> ('q' || i)) is distinct from 'boolean' then
      raise exception 'Responda todas as perguntas do PAR-Q.';
    end if;
    v_r := v_r || jsonb_build_object('q' || i, (p_respostas ->> ('q' || i))::boolean);
    if (p_respostas ->> ('q' || i))::boolean then v_sim := v_sim + 1; end if;
  end loop;
  update public.alunos set parq = v_r, parq_em = now()
   where id = p_aluno and user_id = auth.uid()
  returning * into a;
  if not found then raise exception 'Cadastro não encontrado.'; end if;
  if v_sim > 0 then
    insert into public.notificacoes (tipo, aluno_id, referencia, mensagem)
    values ('parq_alerta', p_aluno, current_date,
            coalesce(nullif(a.participante_nome, ''), a.nome) || ' respondeu "sim" em ' || v_sim
            || ' pergunta(s) do PAR-Q. Recomende avaliação médica e peça o atestado de liberação antes das aulas.')
    on conflict do nothing;
  end if;
end $$;
revoke all on function public.responder_parq(uuid, jsonb) from public, anon;
grant execute on function public.responder_parq(uuid, jsonb) to authenticated;

-- O responsável completa os dados no primeiro acesso, dizendo quem vai fazer as aulas
-- (ele mesmo, ou um dependente com nome e data de nascimento).
drop function if exists public.completar_cadastro(uuid, text, text, text, date, text, text);
create or replace function public.completar_cadastro(
  p_aluno uuid, p_nome text, p_telefone text, p_cpf text default null, p_nascimento date default null,
  p_endereco text default null, p_proprio boolean default true,
  p_participante text default null, p_participante_nasc date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if nullif(trim(p_nome), '') is null then raise exception 'Informe o nome completo.'; end if;
  if nullif(trim(p_telefone), '') is null then raise exception 'Informe o telefone.'; end if;
  if p_nascimento is not null and p_nascimento > current_date then raise exception 'Data de nascimento inválida.'; end if;
  if not coalesce(p_proprio, true) and nullif(trim(p_participante), '') is null then
    raise exception 'Informe o nome do dependente.';
  end if;
  if p_participante_nasc is not null and p_participante_nasc > current_date then
    raise exception 'Data de nascimento de quem vai fazer as aulas inválida.';
  end if;
  if (select foto from public.alunos where id = p_aluno and user_id = auth.uid()) is null then
    raise exception 'Envie a foto de perfil para concluir o cadastro.';
  end if;
  if (select termo_aceito_em from public.alunos where id = p_aluno and user_id = auth.uid()) is null then
    raise exception 'Aceite o termo de uso e privacidade para concluir o cadastro.';
  end if;
  update public.alunos
     set nome = left(trim(p_nome), 120),
         telefone = left(trim(p_telefone), 20),
         cpf = left(nullif(trim(p_cpf), ''), 14),
         data_nascimento = p_nascimento,
         endereco = left(nullif(trim(p_endereco), ''), 200),
         participante_proprio = coalesce(p_proprio, true),
         participante_nome = case when coalesce(p_proprio, true) then null else left(trim(p_participante), 120) end,
         participante_nascimento = case when coalesce(p_proprio, true) then null else p_participante_nasc end,
         cadastro_completo = true
   where id = p_aluno and user_id = auth.uid();
  if not found then raise exception 'Cadastro não encontrado.'; end if;
end $$;

-- Aluno se inscreve numa aula (e turma) pelo app: a vaga fica RESERVADA na hora (matrícula + cobrança) e
-- a ficha mostra "Reserva de vaga" até a recepção registrar o primeiro pagamento. Sem vaga: lista de espera.
-- O gestor/admin recebe uma notificação no sino.
-- Turma sem vaga só pode ser escolhida quando TODAS as turmas da aula estão cheias (fila de espera).
drop function if exists public.solicitar_inscricao(uuid, uuid, text, text);
create or replace function public.solicitar_inscricao(p_aluno uuid, p_aula uuid, p_plano text,
                                                      p_obs text default null, p_turma uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_nome text; v_aula text; v_turma text; v_lotada boolean; v_id uuid; v_vagas int; v_ocupadas int; v_status text;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  -- no aviso aparece quem vai fazer a aula (e o responsável, se for um dependente)
  select case when public._participante(a) <> a.nome then public._participante(a) || ' (resp.: ' || a.nome || ')' else a.nome end
    into v_nome from public.alunos a where a.id = p_aluno and a.user_id = auth.uid();
  if not found then raise exception 'Aluno não encontrado.'; end if;
  if p_plano not in ('mensal','semestral','anual') then raise exception 'Plano inválido.'; end if;
  select nome into v_aula from public.aulas where id = p_aula and ativa;
  if not found then raise exception 'Aula não encontrada.'; end if;
  if exists (select 1 from public.turmas where aula_id = p_aula and ativa) then
    if p_turma is null then raise exception 'Escolha a turma.'; end if;
    select nome, lotada into v_turma, v_lotada from public.turmas_publicas where id = p_turma and aula_id = p_aula;
    if not found then raise exception 'Turma não encontrada.'; end if;
    if v_lotada and exists (select 1 from public.turmas_publicas where aula_id = p_aula and not lotada) then
      raise exception 'Essa turma está sem vagas. Escolha outra turma.';
    end if;
  else
    p_turma := null;
    select lotada into v_lotada from public.aulas_publicas where id = p_aula;
  end if;
  if exists (select 1 from public.matriculas where aluno_id = p_aluno and aula_id = p_aula and status in ('ativa','espera')) then
    raise exception 'Você já está inscrito(a) nesta aula.';
  end if;
  perform public._checar_idade(p_aluno, p_aula);
  if exists (select 1 from public.solicitacoes_inscricao where aluno_id = p_aluno and aula_id = p_aula and status = 'pendente') then
    raise exception 'Você já pediu inscrição nesta aula. Aguarde a recepção.';
  end if;

  -- reserva a vaga (ou entra no fim da fila, se já houver fila ou a turma estiver cheia)
  perform 1 from public.aulas where id = p_aula for update;
  v_vagas := coalesce(public._vagas_grupo(p_aula, p_turma), 0);
  select count(*) into v_ocupadas from public.matriculas
   where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'ativa';
  if v_ocupadas < v_vagas and not exists (select 1 from public.matriculas
       where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'espera') then
    v_status := 'ativa';
  else
    v_status := 'espera';
  end if;
  insert into public.matriculas (aluno_id, aula_id, turma_id, plano, status, data_inicio, data_fim)
  values (p_aluno, p_aula, p_turma, p_plano, v_status, current_date, current_date)
  returning id into v_id;
  if v_status = 'ativa' then perform public._criar_cobranca(v_id); end if;

  insert into public.notificacoes (tipo, aluno_id, matricula_id, referencia, mensagem)
  values ('inscricao_solicitada', p_aluno, v_id, current_date,
          v_nome || case when v_status = 'ativa' then ' reservou vaga em ' else ' entrou na lista de espera de ' end
          || v_aula || coalesce(' — ' || v_turma, '') || ' (plano ' || p_plano || ').'
          || coalesce(' Obs.: ' || left(nullif(trim(p_obs), ''), 300), '')
          || case when v_status = 'ativa' then ' A inscrição é confirmada quando o pagamento for registrado.' else '' end);
  -- funcionário isento já sai confirmado: o aviso não precisa ficar aberto
  if v_status = 'ativa' and exists (select 1 from public.pagamentos where matricula_id = v_id and status = 'pago') then
    update public.notificacoes set lida = true where matricula_id = v_id and tipo = 'inscricao_solicitada';
  end if;
  return v_id;
end $$;

-- Gestor/admin recusa um pedido de inscrição.
create or replace function public.recusar_solicitacao(p_solicitacao uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  update public.solicitacoes_inscricao set status = 'recusada', resolvida_em = now()
   where id = p_solicitacao and status = 'pendente';
  update public.notificacoes set lida = true where solicitacao_id = p_solicitacao;
end $$;

revoke all on function public.solicitar_inscricao(uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.recusar_solicitacao(uuid)                   from public, anon;
grant execute on function public.solicitar_inscricao(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.recusar_solicitacao(uuid)                   to authenticated;

-- Uso interno da Edge Function: acha o usuário pelo e-mail.
create or replace function public._usuario_por_email(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.aluno_cadastro_pendente()                                   from public, anon;
revoke all on function public.completar_cadastro(uuid, text, text, text, date, text, boolean, text, date) from public, anon;
revoke all on function public._usuario_por_email(text)                                    from public, anon, authenticated;
grant execute on function public.aluno_cadastro_pendente()                                to authenticated;
grant execute on function public.completar_cadastro(uuid, text, text, text, date, text, boolean, text, date) to authenticated;
grant execute on function public._usuario_por_email(text)                                 to service_role;
grant all on public.alunos, public.gestores to service_role;

revoke all on function public.vincular_aluno()                  from public, anon;
revoke all on function public.painel_aluno()                    from public, anon;
revoke all on function public.informar_pagamento(text, text)    from public, anon;
grant execute on function public.vincular_aluno()               to authenticated;
grant execute on function public.painel_aluno()                 to authenticated;
grant execute on function public.informar_pagamento(text, text) to authenticated;

-- Aluno abriu o link do grupo de WhatsApp da aula: a janela não aparece mais sozinha.
create or replace function public.marcar_grupo_visto(p_matricula uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  update public.matriculas m set grupo_visto = true
    from public.alunos a
   where m.id = p_matricula and a.id = m.aluno_id and a.user_id = auth.uid();
end $$;
revoke all on function public.marcar_grupo_visto(uuid) from public, anon;
grant execute on function public.marcar_grupo_visto(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Comprovantes de pagamento enviados pelo aluno
-- Arquivo vai para o bucket PRIVADO "comprovantes" (pasta = id do usuário);
-- a equipe recebe aviso no sino e a Edge Function "enviar-comprovante" manda por e-mail.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('comprovantes', 'comprovantes', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists comprovantes_envio on storage.objects;
create policy comprovantes_envio on storage.objects for insert to authenticated
  with check (bucket_id = 'comprovantes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists comprovantes_leitura on storage.objects;
create policy comprovantes_leitura on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and (public.is_gestor() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists comprovantes_exclusao on storage.objects;
create policy comprovantes_exclusao on storage.objects for delete to authenticated
  using (bucket_id = 'comprovantes' and public.is_gestor());

create or replace function public.registrar_comprovante(p_aluno uuid, p_arquivo text, p_nome text default null, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_nome text; v_id uuid; v_obs text := left(nullif(trim(p_obs), ''), 300);
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  select nome into v_nome from public.alunos where id = p_aluno and user_id = auth.uid();
  if not found then raise exception 'Aluno não encontrado.'; end if;
  if split_part(p_arquivo, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects where bucket_id = 'comprovantes' and name = p_arquivo) then
    raise exception 'Arquivo não encontrado. Tente enviar de novo.';
  end if;
  if (select count(*) from public.comprovantes c join public.alunos a on a.id = c.aluno_id
       where a.user_id = auth.uid() and c.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Você enviou muitos comprovantes na última hora. Tente mais tarde.';
  end if;
  insert into public.comprovantes (aluno_id, arquivo, nome_arquivo, observacao)
  values (p_aluno, p_arquivo, left(nullif(trim(p_nome), ''), 120), v_obs)
  returning id into v_id;
  insert into public.notificacoes (tipo, aluno_id, referencia, mensagem)
  values ('comprovante_enviado', p_aluno, current_date,
          v_nome || ' enviou um comprovante de pagamento.' || coalesce(' Obs.: ' || v_obs, '')
          || ' Toque para ver na ficha do aluno.');
  return v_id;
end $$;

revoke all on function public.registrar_comprovante(uuid, text, text, text) from public, anon;
grant execute on function public.registrar_comprovante(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Fotos de perfil dos alunos (Storage PRIVADO "perfis"): pasta = id da ficha do aluno.
-- O dono da ficha envia e vê a própria; gestores, admins e professores veem todas.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('perfis', 'perfis', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                              allowed_mime_types = excluded.allowed_mime_types;

-- A pasta (id da ficha) pertence ao usuário logado?
create or replace function public._dono_ficha(p_pasta text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.alunos where id::text = p_pasta and user_id = auth.uid());
$$;
revoke all on function public._dono_ficha(text) from public, anon;
grant execute on function public._dono_ficha(text) to authenticated;

drop policy if exists perfis_leitura on storage.objects;
create policy perfis_leitura on storage.objects for select to authenticated
  using (bucket_id = 'perfis' and (public.is_gestor() or public.is_professor()
                                   or public._dono_ficha((storage.foldername(name))[1])));
drop policy if exists perfis_envio on storage.objects;
create policy perfis_envio on storage.objects for insert to authenticated
  with check (bucket_id = 'perfis' and (public.is_gestor() or public._dono_ficha((storage.foldername(name))[1])));
drop policy if exists perfis_exclusao on storage.objects;
create policy perfis_exclusao on storage.objects for delete to authenticated
  using (bucket_id = 'perfis' and (public.is_gestor() or public._dono_ficha((storage.foldername(name))[1])));

-- Grava a foto na ficha (dono da ficha ou gestor). Devolve o caminho da foto anterior (para apagar).
create or replace function public.definir_foto(p_aluno uuid, p_arquivo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_antiga text;
begin
  if not (public.is_gestor() or exists (select 1 from public.alunos where id = p_aluno and user_id = auth.uid())) then
    raise exception 'Acesso negado.';
  end if;
  if split_part(p_arquivo, '/', 1) <> p_aluno::text
     or not exists (select 1 from storage.objects where bucket_id = 'perfis' and name = p_arquivo) then
    raise exception 'Foto não encontrada. Tente enviar de novo.';
  end if;
  select foto into v_antiga from public.alunos where id = p_aluno;
  update public.alunos set foto = p_arquivo where id = p_aluno;
  return nullif(v_antiga, p_arquivo);
end $$;
revoke all on function public.definir_foto(uuid, text) from public, anon;
grant execute on function public.definir_foto(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Fotos das aulas (Storage): leitura pública, escrita só de gestores
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('aulas', 'aulas', true)
on conflict (id) do nothing;

drop policy if exists aulas_fotos_leitura on storage.objects;
create policy aulas_fotos_leitura on storage.objects for select using (bucket_id = 'aulas');
drop policy if exists aulas_fotos_gestor on storage.objects;
create policy aulas_fotos_gestor on storage.objects for all to authenticated
  using (bucket_id = 'aulas' and public.is_gestor())
  with check (bucket_id = 'aulas' and public.is_gestor());

-- ---------------------------------------------------------------------
-- Anúncios (aba "Anúncios" dos admins). Aparecem como balão para alunos e professores,
-- que confirmam com "Entendi". Podem ser programados (início no futuro), repetir
-- (todo dia / semana / mês, no mesmo horário do início) e ter data de expiração:
-- a partir de 00:00 do dia em "expira_em" (horário de Brasília) o anúncio some.
-- ---------------------------------------------------------------------
create table if not exists public.anuncios (
  id          uuid primary key default gen_random_uuid(),
  titulo      text check (titulo is null or length(titulo) <= 120),
  mensagem    text not null check (length(btrim(mensagem)) between 1 and 2000),
  inicio      timestamptz not null default now(),
  recorrencia text not null default 'unica' check (recorrencia in ('unica','diaria','semanal','mensal')),
  expira_em   date,
  ativo       boolean not null default true,   -- false = pausado
  criado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Quem já clicou em "Entendi" (por ocorrência: um anúncio diário volta no dia seguinte).
create table if not exists public.anuncios_vistos (
  anuncio_id uuid not null references public.anuncios(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  ocorrencia timestamptz not null,
  visto_em   timestamptz not null default now(),
  primary key (anuncio_id, user_id, ocorrencia)
);

alter table public.anuncios        enable row level security;
alter table public.anuncios_vistos enable row level security;
grant select, insert, update, delete on public.anuncios to authenticated;
grant select on public.anuncios_vistos to authenticated;  -- o "Entendi" é gravado pela função anuncio_entendi
grant all on public.anuncios, public.anuncios_vistos to service_role;
drop policy if exists anuncios_gestor on public.anuncios;
create policy anuncios_gestor on public.anuncios for all to authenticated
  using (public.is_gestor()) with check (public.is_gestor());
drop policy if exists anuncios_vistos_gestor on public.anuncios_vistos;
create policy anuncios_vistos_gestor on public.anuncios_vistos for select to authenticated
  using (public.is_gestor());

-- Ocorrência mais recente que já começou (null = ainda não começou).
create or replace function public._anuncio_ocorrencia(p_inicio timestamptz, p_rec text, p_agora timestamptz default now())
returns timestamptz
language plpgsql stable
set search_path = public
as $$
declare n int; t timestamptz;
begin
  if p_inicio > p_agora then return null; end if;
  if p_rec = 'diaria' then
    return p_inicio + floor(extract(epoch from p_agora - p_inicio) / 86400)::int * interval '1 day';
  elsif p_rec = 'semanal' then
    return p_inicio + floor(extract(epoch from p_agora - p_inicio) / 604800)::int * interval '7 days';
  elsif p_rec = 'mensal' then
    n := (extract(year from age(p_agora, p_inicio)) * 12 + extract(month from age(p_agora, p_inicio)))::int;
    t := p_inicio + n * interval '1 month';
    if t > p_agora then t := p_inicio + (n - 1) * interval '1 month'; end if;
    return t;
  end if;
  return p_inicio;
end $$;

-- Anúncios que o usuário logado ainda precisa ver agora.
create or replace function public.meus_anuncios()
returns table (id uuid, titulo text, mensagem text, ocorrencia timestamptz)
language sql stable security definer
set search_path = public
as $$
  select a.id, a.titulo, a.mensagem, o.oc
  from public.anuncios a
  cross join lateral (select public._anuncio_ocorrencia(a.inicio, a.recorrencia) as oc) o
  where auth.uid() is not null
    and a.ativo
    and o.oc is not null
    and (a.expira_em is null or (now() at time zone 'America/Sao_Paulo')::date < a.expira_em)
    and not exists (select 1 from public.anuncios_vistos v
                    where v.anuncio_id = a.id and v.user_id = auth.uid() and v.ocorrencia = o.oc)
  order by o.oc;
$$;
revoke all on function public.meus_anuncios() from public, anon;
grant execute on function public.meus_anuncios() to authenticated;

-- Botão "Entendi".
create or replace function public.anuncio_entendi(p_anuncio uuid, p_ocorrencia timestamptz)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.'; end if;
  insert into public.anuncios_vistos (anuncio_id, user_id, ocorrencia)
  select p_anuncio, auth.uid(), p_ocorrencia
  where exists (select 1 from public.anuncios where id = p_anuncio)
  on conflict do nothing;
end $$;
revoke all on function public.anuncio_entendi(uuid, timestamptz) from public, anon;
grant execute on function public.anuncio_entendi(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Aulas iniciais (EXEMPLO — edite preços e vagas pelo app)
-- ---------------------------------------------------------------------
insert into public.aulas (nome, descricao, vagas, ordem)
select * from (values
  ('Musculação',          'Treino com acompanhamento de profissionais, para todos os níveis.',           30, 1),
  ('Natação para bebês',  'Estimulação aquática para bebês, com a presença dos responsáveis.',            8, 2),
  ('Natação infantil',    'Aulas de natação para crianças, do aprendizado básico ao aperfeiçoamento.',   16, 3),
  ('Hidroginástica',      'Exercícios na água, de baixo impacto e ótimos para o condicionamento.',       20, 4)
) as v(nome, descricao, vagas, ordem)
where not exists (select 1 from public.aulas);

-- ---------------------------------------------------------------------
-- Verificação AUTOMÁTICA de vencimentos (cobranças + avisos) todo dia às 06:00 e 12:00
-- (horário de Brasília = 09:00 e 15:00 UTC), mesmo sem ninguém abrir o app.
-- Usa a extensão pg_cron: o bloco tenta ativá-la sozinho. Se o Supabase não deixar,
-- ative em Database > Extensions > pg_cron e rode este arquivo de novo.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'Não foi possível ativar o pg_cron automaticamente (%). Ative em Database > Extensions.', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cevisa-pendencias';
    perform cron.schedule('cevisa-pendencias', '0 9,15 * * *', 'select public._atualizar_pendencias()');
  end if;
end $$;

-- Para conferir se está agendado:   select jobname, schedule, active from cron.job;
-- Para ver as últimas execuções:   select status, start_time, return_message from cron.job_run_details order by start_time desc limit 10;
-- ---------------------------------------------------------------------
-- PRIMEIRO GESTOR: crie o usuário em Authentication > Users e depois rode
-- (troque o e-mail):
--
-- insert into public.gestores (user_id, nome)
-- select id, 'Nome do gestor' from auth.users where email = 'gestor@exemplo.com';
-- =====================================================================

-- =====================================================================
-- Desconto na matrícula, planos semestral/anual parcelados no cartão e
-- comprovante anexado pela equipe em cobranças pagas.
-- =====================================================================

-- O gestor muda ou retira o desconto de uma matrícula (p_valor null = volta ao preço normal).
-- A cobrança pendente dessa matrícula passa a usar o novo valor.
create or replace function public.definir_desconto(p_matricula uuid, p_valor numeric, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'Valor com desconto inválido.'; end if;
  if p_valor is not null and nullif(trim(p_motivo), '') is null then raise exception 'Informe o motivo do desconto.'; end if;
  update public.matriculas
     set valor_personalizado = round(p_valor, 2),
         desconto_motivo = case when p_valor is not null then left(trim(p_motivo), 300) end,
         desconto_em     = case when p_valor is not null then now() end
   where id = p_matricula and status in ('ativa','espera');
  if not found then raise exception 'Matrícula ativa não encontrada.'; end if;
  update public.pagamentos set valor = coalesce(public._preco_matricula(p_matricula), valor)
   where matricula_id = p_matricula and status = 'pendente';
  perform public._quitar_isentos(p_matricula);
end $$;
revoke all on function public.definir_desconto(uuid, numeric, text) from public, anon;
grant execute on function public.definir_desconto(uuid, numeric, text) to authenticated;

-- Em quantas vezes o pagamento foi dividido no cartão (1 = à vista).
alter table public.pagamentos add column if not exists parcelas integer not null default 1
  check (parcelas between 1 and 24);

-- Entradas de dinheiro no período: o pagamento entra INTEIRO no mês em que foi pago
-- (semestral/anual: o valor total do plano conta só no mês do pagamento, mesmo parcelado no cartão).
create or replace function public._entradas(p_ini date, p_fim date)
returns table (pagamento_id uuid, matricula_id uuid, aluno_id uuid, plano text, forma text, pago_em date,
               data date, parcela int, parcelas int, valor numeric, valor_total numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.matricula_id, p.aluno_id, p.plano, p.forma, p.pago_em,
         p.pago_em, 1, p.parcelas, p.valor, p.valor
    from public.pagamentos p
   where p.status = 'pago' and p.pago_em is not null
     and p.pago_em >= p_ini and p.pago_em < p_fim;
$$;
revoke all on function public._entradas(date, date) from public, anon, authenticated;

-- "Lançar semestral" / "Lançar anual" (aba Cobranças): quita o próximo período do plano
-- (6 ou 12 meses) e registra em quantas vezes foi dividido no cartão.
create or replace function public.lancar_plano(p_matricula uuid, p_parcelas int default 1,
                                               p_forma text default null, p_data date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.matriculas; p public.pagamentos;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if p_parcelas is null or p_parcelas < 1 or p_parcelas > 24 then raise exception 'Número de parcelas inválido (1 a 24).'; end if;
  if p_data > current_date then raise exception 'A data do pagamento não pode ser no futuro.'; end if;
  select * into m from public.matriculas where id = p_matricula for update;
  if not found or m.status <> 'ativa' then raise exception 'Matrícula ativa não encontrada.'; end if;
  if m.plano not in ('semestral','anual') then raise exception 'Esta matrícula não é do plano semestral ou anual.'; end if;
  perform public._criar_cobranca(m.id);
  select * into p from public.pagamentos
   where matricula_id = m.id and status = 'pendente' order by vencimento limit 1;
  if not found then raise exception 'Não há valor a cobrar neste plano (isento).'; end if;
  update public.pagamentos set parcelas = p_parcelas where id = p.id;
  perform public.registrar_pagamento(p.id, p_forma, p_data);
  return p.id;
end $$;
revoke all on function public.lancar_plano(uuid, int, text, date) from public, anon;
grant execute on function public.lancar_plano(uuid, int, text, date) to authenticated;

-- Comprovante anexado pela equipe a uma cobrança já paga (imagem no bucket privado "comprovantes",
-- na pasta do usuário da equipe). Aparece na cobrança e na ficha do aluno.
alter table public.comprovantes add column if not exists pagamento_id uuid references public.pagamentos(id) on delete set null;
create index if not exists comprovantes_pagamento_idx on public.comprovantes (pagamento_id);

create or replace function public.anexar_comprovante(p_pagamento uuid, p_arquivo text, p_nome text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.pagamentos; v_id uuid;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  select * into p from public.pagamentos where id = p_pagamento;
  if not found then raise exception 'Cobrança não encontrada.'; end if;
  if p.status <> 'pago' then raise exception 'Só é possível anexar comprovante em cobrança paga.'; end if;
  if split_part(p_arquivo, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects where bucket_id = 'comprovantes' and name = p_arquivo) then
    raise exception 'Arquivo não encontrado. Tente enviar de novo.';
  end if;
  insert into public.comprovantes (aluno_id, arquivo, nome_arquivo, observacao, email_enviado, pagamento_id)
  values (p.aluno_id, p_arquivo, left(nullif(trim(p_nome), ''), 120), 'Anexado pela equipe', true, p.id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.anexar_comprovante(uuid, text, text) from public, anon;
grant execute on function public.anexar_comprovante(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- Família: o responsável (pai/mãe) cadastra dependentes. Cada pessoa que faz aula tem a
-- própria ficha (foto, PAR-Q, turma), todas ligadas ao mesmo acesso do responsável, que vê
-- e paga tudo junto. A ficha do dependente repete os contatos do responsável (cobrança,
-- WhatsApp e e-mail vão para ele) e aponta para a ficha principal em responsavel_id.
-- =====================================================================
alter table public.alunos add column if not exists responsavel_id uuid references public.alunos(id) on delete set null;
create index if not exists alunos_responsavel_idx on public.alunos (responsavel_id);

-- Fichas da mesma família: a principal, as que apontam para ela e as do mesmo acesso/e-mail.
create or replace function public._familia(p_aluno uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with base as (select a.* from public.alunos a where a.id = p_aluno),
       raiz as (select r.* from public.alunos r join base b on r.id = coalesce(b.responsavel_id, b.id))
  select distinct x.id from public.alunos x, raiz r
   where x.id = p_aluno or x.id = r.id or x.responsavel_id = r.id
      or (r.user_id is not null and x.user_id = r.user_id)
      or (nullif(trim(r.email), '') is not null and lower(trim(x.email)) = lower(trim(r.email)));
$$;
revoke all on function public._familia(uuid) from public, anon, authenticated;

-- Fichas da família de um aluno (para o quadro "Família" da ficha). Só a equipe.
create or replace function public.familia_aluno(p_aluno uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', a.id, 'nome', a.nome, 'participante', public._participante(a), 'foto', a.foto,
            'ativo', a.ativo, 'principal', a.responsavel_id is null, 'parentesco', a.parentesco, 'sexo', a.sexo,
            'aulas', (select count(*) from public.matriculas m where m.aluno_id = a.id and m.status in ('ativa','espera')))
           order by (a.responsavel_id is not null), a.created_at)
    from public.alunos a where a.id in (select public._familia(p_aluno))), '[]'::jsonb);
end $$;
revoke all on function public.familia_aluno(uuid) from public, anon;
grant execute on function public.familia_aluno(uuid) to authenticated;

-- Sexo e grau de parentesco (com o responsável) de cada dependente.
alter table public.alunos add column if not exists sexo text;
alter table public.alunos add column if not exists parentesco text;
alter table public.alunos drop constraint if exists alunos_sexo_check;
alter table public.alunos add constraint alunos_sexo_check check (sexo is null or sexo in ('F','M'));

-- Adiciona um dependente. O responsável (no app, p_base = null) ou a equipe (p_base = ficha do responsável).
-- A nova ficha copia os dados de contato e o aceite do termo do responsável; foto e PAR-Q do
-- dependente são pedidos ao responsável no próximo acesso ao app.
drop function if exists public.adicionar_dependente(uuid, text, date);
create or replace function public.adicionar_dependente(p_base uuid, p_nome text, p_nascimento date default null,
                                                       p_sexo text default null, p_parentesco text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.alunos; v_id uuid; v_nome text := left(trim(coalesce(p_nome, '')), 120);
        v_par text := left(nullif(trim(p_parentesco), ''), 40);
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if public.is_gestor() and p_base is not null then
    select * into b from public.alunos where id = p_base;
  else
    select * into b from public.alunos
     where user_id = auth.uid() and (p_base is null or id = p_base)
     order by (responsavel_id is not null), participante_proprio desc, created_at limit 1;
  end if;
  if not found then raise exception 'Cadastro do responsável não encontrado.'; end if;
  if v_nome = '' then raise exception 'Informe o nome completo do dependente.'; end if;
  if p_nascimento is not null and p_nascimento > current_date then raise exception 'Data de nascimento inválida.'; end if;
  if p_sexo is null or p_sexo not in ('F','M') then raise exception 'Informe o sexo do dependente.'; end if;
  if v_par is null then raise exception 'Informe o grau de parentesco com o dependente.'; end if;
  if exists (select 1 from public.alunos a where a.id in (select public._familia(b.id))
              and lower(public._participante(a)) = lower(v_nome)) then
    raise exception '% já está cadastrado(a) na família.', v_nome;
  end if;
  if (select count(*) from public.alunos a where a.id in (select public._familia(b.id))) >= 10 then
    raise exception 'Limite de fichas na família atingido. Fale com a recepção.';
  end if;

  insert into public.alunos (nome, cpf, telefone, email, endereco, endereco_detalhe, user_id, ativo, cadastro_completo,
                             participante_proprio, participante_nome, participante_nascimento,
                             termo_aceito_em, termo_versao, vinculo, vinculo_declarado, criado_por, responsavel_id,
                             sexo, parentesco)
  values (b.nome, b.cpf, b.telefone, b.email, b.endereco, b.endereco_detalhe, b.user_id, true, true,
          false, v_nome, p_nascimento,
          b.termo_aceito_em, b.termo_versao, 'externo', 'externo', auth.uid(), coalesce(b.responsavel_id, b.id),
          p_sexo, v_par)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.adicionar_dependente(uuid, text, date, text, text) from public, anon;
grant execute on function public.adicionar_dependente(uuid, text, date, text, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- Endereço completo (preenchido pelo CEP no cadastro). O texto em "endereco" é montado
-- a partir das partes, guardadas em endereco_detalhe para editar depois.
-- =====================================================================
alter table public.alunos add column if not exists endereco_detalhe jsonb;

create or replace function public.definir_endereco(p_aluno uuid, p_cep text, p_logradouro text, p_numero text,
                                                   p_complemento text, p_bairro text, p_cidade text, p_uf text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cep text := regexp_replace(coalesce(p_cep, ''), '\D', '', 'g');
  v_log text := left(nullif(trim(p_logradouro), ''), 150);
  v_num text := left(nullif(trim(p_numero), ''), 20);
  v_comp text := left(nullif(trim(p_complemento), ''), 80);
  v_bai text := left(nullif(trim(p_bairro), ''), 80);
  v_cid text := left(nullif(trim(p_cidade), ''), 80);
  v_uf  text := upper(left(nullif(trim(p_uf), ''), 2));
  v_txt text;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if not public.is_gestor() and not exists (select 1 from public.alunos where id = p_aluno and user_id = auth.uid()) then
    raise exception 'Cadastro não encontrado.';
  end if;
  if v_cep <> '' and length(v_cep) <> 8 then raise exception 'CEP inválido: use 8 números.'; end if;
  if v_log is null or v_num is null or v_bai is null or v_cid is null or v_uf is null then
    raise exception 'Preencha o endereço completo: rua, número, bairro, cidade e estado.';
  end if;
  if v_uf !~ '^[A-Z]{2}$' then raise exception 'Estado (UF) inválido.'; end if;
  if v_cep <> '' then v_cep := substr(v_cep, 1, 5) || '-' || substr(v_cep, 6, 3); end if;
  v_txt := v_log || ', ' || v_num || coalesce(' - ' || v_comp, '') || ' - ' || v_bai || ', ' || v_cid || '/' || v_uf
           || case when v_cep <> '' then ' - CEP ' || v_cep else '' end;
  update public.alunos
     set endereco = v_txt,
         endereco_detalhe = jsonb_build_object('cep', nullif(v_cep, ''), 'logradouro', v_log, 'numero', v_num,
                                               'complemento', v_comp, 'bairro', v_bai, 'cidade', v_cid, 'uf', v_uf)
   where id = p_aluno;
  -- dependentes da família recebem o mesmo endereço do responsável
  update public.alunos d set endereco = v_txt, endereco_detalhe = (select endereco_detalhe from public.alunos where id = p_aluno)
   where d.responsavel_id = p_aluno;
  return v_txt;
end $$;
revoke all on function public.definir_endereco(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.definir_endereco(uuid, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- Professor: cadastro manual (aluno sem celular/e-mail) já com a inscrição numa aula DELE.
-- A vaga fica como "Reserva de vaga" até a recepção registrar o pagamento (o professor não vê valores).
-- =====================================================================
create or replace function public.professor_cadastrar_aluno(
  p_nome text, p_telefone text, p_nascimento date, p_cpf text, p_email text,
  p_aula uuid, p_turma uuid, p_plano text, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_nome text := left(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 120);
  v_tel text := left(nullif(trim(p_telefone), ''), 20);
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  v_email text := lower(nullif(trim(p_email), ''));
  v_aula text; v_turma text; v_prof text; v_id uuid; v_mat uuid; v_status text; v_vagas int; v_ocupadas int; v_pos int;
begin
  if not public.is_professor() then raise exception 'Acesso negado.'; end if;
  if not exists (select 1 from public.professor_aulas where user_id = auth.uid() and aula_id = p_aula) then
    raise exception 'Você só pode inscrever alunos nas suas modalidades.';
  end if;
  if position(' ' in v_nome) = 0 then
    raise exception 'Informe o nome completo (nome e sobrenome).';
  end if;
  if length(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g')) < 10 then raise exception 'Informe o telefone com DDD.'; end if;
  if p_nascimento is null or p_nascimento > current_date then raise exception 'Informe a data de nascimento.'; end if;
  if v_cpf is not null and length(v_cpf) <> 11 then raise exception 'CPF inválido: use 11 números.'; end if;
  if v_email is not null and v_email !~ '^\S+@\S+\.\S+$' then raise exception 'E-mail inválido.'; end if;
  if p_plano not in ('mensal','semestral','anual') then raise exception 'Plano inválido.'; end if;
  -- evita ficha duplicada: a recepção inscreve quem já tem cadastro
  if (v_cpf is not null and exists (select 1 from public.alunos where regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf))
     or exists (select 1 from public.alunos a where lower(public._participante(a)) = lower(v_nome)
                   and public._nascimento_participante(a) = p_nascimento) then
    raise exception 'Este aluno já tem cadastro. Peça à recepção para inscrevê-lo, ou ele mesmo se inscreve pelo app.';
  end if;

  perform 1 from public.aulas where id = p_aula and ativa for update;
  if not found then raise exception 'Aula não encontrada.'; end if;
  select nome into v_aula from public.aulas where id = p_aula;
  if exists (select 1 from public.turmas where aula_id = p_aula and ativa) then
    if p_turma is null then raise exception 'Escolha a turma.'; end if;
    select nome into v_turma from public.turmas where id = p_turma and aula_id = p_aula and ativa;
    if not found then raise exception 'Turma não encontrada nesta aula.'; end if;
  else
    p_turma := null;
  end if;

  insert into public.alunos (nome, cpf, data_nascimento, telefone, email, observacoes, ativo, cadastro_completo, criado_por, vinculo)
  values (v_nome, case when v_cpf is not null then substr(v_cpf,1,3)||'.'||substr(v_cpf,4,3)||'.'||substr(v_cpf,7,3)||'-'||substr(v_cpf,10,2) end,
          p_nascimento, v_tel, v_email, left(nullif(trim(p_obs), ''), 800), true, true, auth.uid(), 'externo')
  returning id into v_id;
  perform public._checar_idade(v_id, p_aula);

  v_vagas := coalesce(public._vagas_grupo(p_aula, p_turma), 0);
  select count(*) into v_ocupadas from public.matriculas
   where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'ativa';
  if v_ocupadas < v_vagas and not exists (select 1 from public.matriculas
       where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'espera') then
    v_status := 'ativa';
  else
    v_status := 'espera';
  end if;
  insert into public.matriculas (aluno_id, aula_id, turma_id, plano, status, data_inicio, data_fim)
  values (v_id, p_aula, p_turma, p_plano, v_status, current_date, current_date)
  returning id into v_mat;
  if v_status = 'ativa' then
    perform public._criar_cobranca(v_mat);
  else
    select count(*) into v_pos from public.matriculas
     where aula_id = p_aula and turma_id is not distinct from p_turma and status = 'espera'
       and (created_at, id) <= (select created_at, id from public.matriculas where id = v_mat);
  end if;

  select coalesce(nome, 'Professor(a)') into v_prof from public.gestores where user_id = auth.uid();
  insert into public.notificacoes (tipo, aluno_id, matricula_id, referencia, mensagem)
  values ('inscricao_solicitada', v_id, v_mat, current_date,
          coalesce(v_prof, 'Professor(a)') || ' cadastrou ' || v_nome || ' (sem acesso ao app) e '
          || case when v_status = 'ativa' then 'reservou vaga em ' else 'colocou na lista de espera de ' end
          || v_aula || coalesce(' — ' || v_turma, '') || ' (plano ' || p_plano || ').'
          || case when v_status = 'ativa' then ' Registre o pagamento para confirmar a inscrição.' else '' end);
  return jsonb_build_object('aluno_id', v_id, 'matricula_id', v_mat, 'status', v_status, 'posicao_espera', v_pos);
end $$;
revoke all on function public.professor_cadastrar_aluno(text, text, date, text, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.professor_cadastrar_aluno(text, text, date, text, text, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
