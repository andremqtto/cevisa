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
-- Segurança (RLS)
-- ---------------------------------------------------------------------

create or replace function public.is_gestor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.gestores where user_id = auth.uid());
$$;

alter table public.gestores     enable row level security;
alter table public.aulas        enable row level security;
alter table public.alunos       enable row level security;
alter table public.matriculas   enable row level security;
alter table public.pagamentos   enable row level security;
alter table public.trancamentos enable row level security;
alter table public.notificacoes enable row level security;

drop policy if exists gestores_self   on public.gestores;
create policy gestores_self   on public.gestores     for select to authenticated using (user_id = auth.uid());
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
create or replace view public.aulas_publicas as
  select id, nome, descricao, foto_url, preco_mensal, preco_semestral, preco_anual, ordem
  from public.aulas
  where ativa
  order by ordem, nome;

grant select on public.aulas_publicas to anon, authenticated;

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

-- Promove quem está na lista de espera enquanto houver vaga (ordem de reserva).
create or replace function public._promover_espera(p_aula uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_vagas int; v_ocupadas int; m public.matriculas; v_nome text; v_aula text;
begin
  select vagas, nome into v_vagas, v_aula from public.aulas where id = p_aula;
  loop
    select count(*) into v_ocupadas from public.matriculas where aula_id = p_aula and status = 'ativa';
    exit when v_ocupadas >= v_vagas;
    select * into m from public.matriculas
      where aula_id = p_aula and status = 'espera'
      order by created_at, id limit 1 for update skip locked;
    exit when not found;
    update public.matriculas
       set status = 'ativa', data_inicio = current_date, data_fim = current_date
     where id = m.id;
    perform public._criar_cobranca(m.id);
    select nome into v_nome from public.alunos where id = m.aluno_id;
    insert into public.notificacoes (tipo, aluno_id, matricula_id, referencia, mensagem)
    values ('vaga_liberada', m.aluno_id, m.id, current_date,
            v_nome || ' saiu da lista de espera de ' || v_aula || ' e já tem vaga. Avise o aluno e registre o pagamento.')
    on conflict do nothing;
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

-- ---------------------------------------------------------------------
-- Funções chamadas pelo app (RPC) — todas exigem gestor
-- ---------------------------------------------------------------------

create or replace function public.atualizar_pendencias()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  perform public._atualizar_pendencias();
end $$;

-- Inscreve o aluno; se não houver vaga entra na lista de espera.
-- Retorna: { matricula_id, status, posicao_espera }
create or replace function public.inscrever_aluno(p_aluno uuid, p_aula uuid, p_plano text, p_inicio date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vagas int; v_ocupadas int; v_id uuid; v_status text; v_pos int;
begin
  if not public.is_gestor() then raise exception 'Acesso negado.'; end if;
  if p_plano not in ('mensal','semestral','anual') then raise exception 'Plano inválido.'; end if;

  select vagas into v_vagas from public.aulas where id = p_aula and ativa for update;
  if not found then raise exception 'Aula não encontrada ou oculta.'; end if;

  if exists (select 1 from public.matriculas
              where aluno_id = p_aluno and aula_id = p_aula and status in ('ativa','espera')) then
    raise exception 'Este aluno já está inscrito (ou na lista de espera) nesta aula.';
  end if;

  select count(*) into v_ocupadas from public.matriculas where aula_id = p_aula and status = 'ativa';
  -- se já existe fila, quem chega agora entra no fim dela
  if v_ocupadas < v_vagas and not exists (select 1 from public.matriculas where aula_id = p_aula and status = 'espera') then
    v_status := 'ativa';
  else
    v_status := 'espera';
  end if;

  insert into public.matriculas (aluno_id, aula_id, plano, status, data_inicio, data_fim)
  values (p_aluno, p_aula, p_plano, v_status, coalesce(p_inicio, current_date), coalesce(p_inicio, current_date))
  returning id into v_id;

  if v_status = 'ativa' then
    perform public._criar_cobranca(v_id);
    v_pos := null;
  else
    select count(*) into v_pos from public.matriculas
     where aula_id = p_aula and status = 'espera' and (created_at, id) <= (select created_at, id from public.matriculas where id = v_id);
  end if;

  return jsonb_build_object('matricula_id', v_id, 'status', v_status, 'posicao_espera', v_pos);
end $$;

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
revoke all on function public.inscrever_aluno(uuid, uuid, text, date)       from public, anon;
revoke all on function public.encerrar_matricula(uuid)                      from public, anon;
revoke all on function public.registrar_pagamento(uuid, text, date)         from public, anon;
revoke all on function public.trancar_mes(uuid, date)                       from public, anon;
revoke all on function public.desfazer_trancamento(uuid)                    from public, anon;
revoke all on function public.relatorio_mensal(int, int)                    from public, anon;
grant execute on function public.atualizar_pendencias()                     to authenticated;
grant execute on function public.inscrever_aluno(uuid, uuid, text, date)    to authenticated;
grant execute on function public.encerrar_matricula(uuid)                   to authenticated;
grant execute on function public.registrar_pagamento(uuid, text, date)      to authenticated;
grant execute on function public.trancar_mes(uuid, date)                    to authenticated;
grant execute on function public.desfazer_trancamento(uuid)                 to authenticated;
grant execute on function public.relatorio_mensal(int, int)                 to authenticated;

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
