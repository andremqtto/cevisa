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
alter table public.gestores add constraint gestores_papel_check check (papel in ('gestor','admin'));

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
  check (tipo in ('vence_em_breve','vencido','vaga_liberada','pagamento_informado','inscricao_solicitada','comprovante_enviado'));

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
  select exists (select 1 from public.gestores where user_id = auth.uid());
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
create policy gestores_self   on public.gestores     for select to authenticated using (user_id = auth.uid() or public.is_gestor_principal());
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
                      where m.aula_id = a.id and m.turma_id is null and m.status = 'espera')) as lotada
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
          coalesce(public._preco_do_plano(m.aula_id, m.plano), 0),
          m.data_fim);
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

-- Inscreve o aluno (numa turma, se a aula tiver turmas); se não houver vaga entra na lista de espera.
-- Retorna: { matricula_id, status, posicao_espera }
drop function if exists public.inscrever_aluno(uuid, uuid, text, date);
create or replace function public.inscrever_aluno(p_aluno uuid, p_aula uuid, p_plano text,
                                                  p_inicio date default current_date, p_turma uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vagas int; v_ocupadas int; v_id uuid; v_status text; v_pos int;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if p_plano not in ('mensal','semestral','anual') then raise exception 'Plano inválido.'; end if;

  perform 1 from public.aulas where id = p_aula and ativa for update;
  if not found then raise exception 'Aula não encontrada ou oculta.'; end if;
  if p_turma is null and exists (select 1 from public.turmas where aula_id = p_aula and ativa) then
    raise exception 'Escolha a turma.';
  end if;
  if p_turma is not null and not exists (select 1 from public.turmas where id = p_turma and aula_id = p_aula) then
    raise exception 'Turma não encontrada nesta aula.';
  end if;

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

  insert into public.matriculas (aluno_id, aula_id, turma_id, plano, status, data_inicio, data_fim)
  values (p_aluno, p_aula, p_turma, p_plano, v_status, coalesce(p_inicio, current_date), coalesce(p_inicio, current_date))
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
   where matricula_id = p.matricula_id and tipo in ('vence_em_breve','vencido','vaga_liberada');
  update public.notificacoes set lida = true
   where aluno_id = p.aluno_id and tipo in ('pagamento_informado','comprovante_enviado');
end $$;

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
    -- Mesmo relatório, separado por modalidade (aula)
    'modalidades', coalesce((select jsonb_agg(x order by x->>'ordem_', x->>'aula') from (
        select jsonb_build_object(
          'aula_id', au.id, 'aula', au.nome, 'ordem_', lpad(au.ordem::text, 6, '0'),
          'alunos_ativos', (select count(*) from public.matriculas m where m.aula_id = au.id and m.status = 'ativa'),
          'na_espera',     (select count(*) from public.matriculas m where m.aula_id = au.id and m.status = 'espera'),
          'novas_matriculas', (select count(*) from public.matriculas m where m.aula_id = au.id and m.status <> 'espera'
                                 and (m.created_at at time zone 'America/Sao_Paulo')::date >= v_ini
                                 and (m.created_at at time zone 'America/Sao_Paulo')::date <  v_fim),
          'recebido',  coalesce((select sum(p.valor) from public.pagamentos p join public.matriculas m on m.id = p.matricula_id
                                  where m.aula_id = au.id and p.status = 'pago' and p.pago_em >= v_ini and p.pago_em < v_fim), 0),
          'pagamentos', (select count(*) from public.pagamentos p join public.matriculas m on m.id = p.matricula_id
                                  where m.aula_id = au.id and p.status = 'pago' and p.pago_em >= v_ini and p.pago_em < v_fim),
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
    'recebido',   coalesce((select sum(valor) from public.pagamentos
                             where status = 'pago' and pago_em >= v_ini and pago_em < v_fim), 0),
    'a_receber',  coalesce((select sum(valor) from public.pagamentos
                             where status = 'pendente' and vencimento >= v_ini and vencimento < v_fim), 0),
    'recebimentos', coalesce((select jsonb_agg(jsonb_build_object(
                         'pagamento_id', p.id, 'aluno_id', p.aluno_id, 'aluno', a.nome, 'plano', p.plano,
                         'valor', p.valor, 'pago_em', p.pago_em, 'forma', p.forma) order by p.pago_em, a.nome)
                       from public.pagamentos p join public.alunos a on a.id = p.aluno_id
                       where p.status = 'pago' and p.pago_em >= v_ini and p.pago_em < v_fim), '[]'::jsonb),
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
revoke all on function public.inscrever_aluno(uuid, uuid, text, date, uuid) from public, anon;
revoke all on function public.encerrar_matricula(uuid)                      from public, anon;
revoke all on function public.registrar_pagamento(uuid, text, date)         from public, anon;
revoke all on function public.trancar_mes(uuid, date)                       from public, anon;
revoke all on function public.desfazer_trancamento(uuid)                    from public, anon;
revoke all on function public.relatorio_mensal(int, int)                    from public, anon;
grant execute on function public.atualizar_pendencias()                     to authenticated;
grant execute on function public.inscrever_aluno(uuid, uuid, text, date, uuid) to authenticated;
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
           'id', a.id, 'nome', a.nome, 'ativo', a.ativo, 'cadastro_completo', a.cadastro_completo,
           'matriculas', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'id', m.id, 'aula_id', m.aula_id, 'status', m.status, 'plano', m.plano,
                       'data_inicio', m.data_inicio, 'data_fim', m.data_fim,
                       'aula', au.nome, 'horarios', coalesce(t.horarios, au.horarios),
                       'turma_id', m.turma_id, 'turma', t.nome,
                       'preco', public._preco_do_plano(m.aula_id, m.plano),
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
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if exists (select 1 from public.notificacoes n join public.alunos al on al.id = n.aluno_id
              where al.user_id = auth.uid() and n.tipo = 'pagamento_informado'
                and n.created_at > now() - interval '10 minutes') then
    raise exception 'Você já avisou o pagamento há poucos minutos. O gestor já foi notificado.';
  end if;
  for a in select id, nome from public.alunos where user_id = auth.uid() order by nome loop
    select sum(coalesce(p.valor, public._preco_do_plano(m.aula_id, m.plano), 0)),
           min(coalesce(p.vencimento, m.data_fim))
      into v_total, v_venc
      from public.matriculas m
      left join public.pagamentos p on p.matricula_id = m.id and p.status = 'pendente'
     where m.aluno_id = a.id and m.status = 'ativa';
    continue when v_venc is null;
    v_msg := a.nome || ' informou que pagou a(s) mensalidade(s): R$ '
             || replace(to_char(coalesce(v_total, 0), 'FM999999990.00'), '.', ',')
             || ' (vencimento ' || to_char(v_venc, 'DD/MM/YYYY') || ').'
             || coalesce(' Forma: ' || v_forma || '.', '')
             || coalesce(' Obs.: ' || v_obs, '');
    insert into public.notificacoes (tipo, aluno_id, referencia, mensagem)
    values ('pagamento_informado', a.id, current_date, v_msg);
    v_qtd := v_qtd + 1;
  end loop;
  if v_qtd = 0 then raise exception 'Você não tem mensalidades ativas para informar.'; end if;
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

-- Remove um admin (nunca o gestor principal).
create or replace function public.remover_admin(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor_principal() then raise exception 'Apenas o gestor principal pode remover admins.'; end if;
  delete from public.gestores where user_id = p_user and papel = 'admin';
  if not found then raise exception 'Admin não encontrado.'; end if;
end $$;

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
create or replace function public.aluno_cadastro_pendente()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email) order by created_at), '[]'::jsonb)
    from public.alunos where user_id = auth.uid() and not cadastro_completo;
$$;

-- O próprio aluno completa os dados no primeiro acesso.
create or replace function public.completar_cadastro(
  p_aluno uuid, p_nome text, p_telefone text, p_cpf text default null, p_nascimento date default null,
  p_endereco text default null, p_responsavel text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  if nullif(trim(p_nome), '') is null then raise exception 'Informe o nome completo.'; end if;
  if nullif(trim(p_telefone), '') is null then raise exception 'Informe o telefone.'; end if;
  if p_nascimento is not null and p_nascimento > current_date then raise exception 'Data de nascimento inválida.'; end if;
  update public.alunos
     set nome = left(trim(p_nome), 120),
         telefone = left(trim(p_telefone), 20),
         cpf = left(nullif(trim(p_cpf), ''), 14),
         data_nascimento = p_nascimento,
         endereco = left(nullif(trim(p_endereco), ''), 200),
         responsavel = left(nullif(trim(p_responsavel), ''), 120),
         cadastro_completo = true
   where id = p_aluno and user_id = auth.uid();
  if not found then raise exception 'Cadastro não encontrado.'; end if;
end $$;

-- Aluno pede inscrição numa aula (e turma); o gestor/admin recebe uma notificação no sino.
-- Turma sem vaga só pode ser escolhida quando TODAS as turmas da aula estão cheias (fila de espera).
drop function if exists public.solicitar_inscricao(uuid, uuid, text, text);
create or replace function public.solicitar_inscricao(p_aluno uuid, p_aula uuid, p_plano text,
                                                      p_obs text default null, p_turma uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_nome text; v_aula text; v_turma text; v_lotada boolean; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Acesso negado.'; end if;
  select nome into v_nome from public.alunos where id = p_aluno and user_id = auth.uid();
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
  if exists (select 1 from public.solicitacoes_inscricao where aluno_id = p_aluno and aula_id = p_aula and status = 'pendente') then
    raise exception 'Você já pediu inscrição nesta aula. Aguarde a recepção.';
  end if;

  insert into public.solicitacoes_inscricao (aluno_id, aula_id, turma_id, plano, observacao)
  values (p_aluno, p_aula, p_turma, p_plano, left(nullif(trim(p_obs), ''), 300))
  returning id into v_id;

  insert into public.notificacoes (tipo, aluno_id, solicitacao_id, referencia, mensagem)
  values ('inscricao_solicitada', p_aluno, v_id, current_date,
          v_nome || ' pediu ' || case when v_lotada then 'vaga na lista de espera de ' else 'inscrição em ' end
          || v_aula || coalesce(' — ' || v_turma, '') || ' (plano ' || p_plano || ').'
          || coalesce(' Obs.: ' || left(nullif(trim(p_obs), ''), 300), '')
          || ' Toque para abrir a ficha e inscrever.');
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
revoke all on function public.completar_cadastro(uuid, text, text, text, date, text, text) from public, anon;
revoke all on function public._usuario_por_email(text)                                    from public, anon, authenticated;
grant execute on function public.aluno_cadastro_pendente()                                to authenticated;
grant execute on function public.completar_cadastro(uuid, text, text, text, date, text, text) to authenticated;
grant execute on function public._usuario_por_email(text)                                 to service_role;
grant all on public.alunos, public.gestores to service_role;

revoke all on function public.vincular_aluno()                  from public, anon;
revoke all on function public.painel_aluno()                    from public, anon;
revoke all on function public.informar_pagamento(text, text)    from public, anon;
grant execute on function public.vincular_aluno()               to authenticated;
grant execute on function public.painel_aluno()                 to authenticated;
grant execute on function public.informar_pagamento(text, text) to authenticated;

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
-- Opcional: rodar a verificação de vencimentos todo dia às 06:00 (horário de Brasília)
-- Ative a extensão pg_cron em Database > Extensions e descomente:
--
-- select cron.schedule('cevisa-pendencias', '0 9 * * *', $$select public._atualizar_pendencias()$$);
--
-- ---------------------------------------------------------------------
-- PRIMEIRO GESTOR: crie o usuário em Authentication > Users e depois rode
-- (troque o e-mail):
--
-- insert into public.gestores (user_id, nome)
-- select id, 'Nome do gestor' from auth.users where email = 'gestor@exemplo.com';
-- =====================================================================
