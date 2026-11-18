// Alunos: lista, cadastro, ficha completa, inscrição em aulas, trancamento.
import { sb, ok } from './supabase.js';
import {
  esc, money, fmtDate, fmtMes, planoLabel, PLANOS, hojeISO, diasEntre, primeiroDiaMes, abrirModal, toast,
  confirmar, comBotao, carregando, vazio, erroBox,
} from './ui.js';
import { registrarPagamento } from './financeiro.js';

const MESES_PLANO = { mensal: 1, semestral: 6, anual: 12 };

/** Soma meses a uma data ISO limitando ao fim do mês (igual ao PostgreSQL). */
function somaMeses(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Situação financeira resumida a partir das matrículas ativas. */
function situacao(matriculas) {
  const ativas = matriculas.filter((m) => m.status === 'ativa');
  if (!ativas.length) {
    return matriculas.some((m) => m.status === 'espera')
      ? { cls: 'alerta', txt: 'Lista de espera', ordem: 3 }
      : { cls: 'cinza', txt: 'Sem aula ativa', ordem: 4 };
  }
  const hoje = hojeISO();
  const menor = ativas.map((m) => m.data_fim).sort()[0];
  const dias = diasEntre(hoje, menor);
  if (dias < 0) return { cls: 'erro', txt: `Vencido há ${-dias} dia(s)`, ordem: 0 };
  if (dias === 0) return { cls: 'alerta', txt: 'Vence hoje', ordem: 1 };
  if (dias <= 7) return { cls: 'alerta', txt: `Vence em ${dias} dia(s)`, ordem: 1 };
  return { cls: 'ok', txt: 'Em dia', ordem: 2 };
}

// ================================================================== LISTA
export async function renderAlunos(el, { navegar }) {
  el.innerHTML = carregando('Carregando alunos…');
  let alunos;
  try {
    alunos = ok(await sb.from('alunos')
      .select('id,nome,telefone,ativo,created_at, matriculas(id,status,plano,data_fim,aulas(nome))')
      .order('nome'));
  } catch (e) { el.innerHTML = erroBox(e); return; }

  let busca = '';
  let filtro = 'todos';

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Alunos</h1><p class="sub" id="contagem"></p></div>
      <button class="btn" type="button" id="novo">＋ Novo aluno</button>
    </div>
    <div class="filtros">
      <input type="text" id="busca" placeholder="Buscar por nome ou telefone…" aria-label="Buscar aluno">
      <select id="filtro" aria-label="Filtrar">
        <option value="todos">Todos</option>
        <option value="ativos">Ativos</option>
        <option value="inativos">Desativados</option>
        <option value="vencidos">Plano vencido / vencendo</option>
        <option value="espera">Em lista de espera</option>
      </select>
    </div>
    <div class="card"><div id="lista"></div></div>`;

  const lista = el.querySelector('#lista');

  function desenhar() {
    const q = busca.trim().toLowerCase();
    const arr = alunos.filter((a) => {
      if (q && !(a.nome.toLowerCase().includes(q) || (a.telefone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'))) return false;
      const s = situacao(a.matriculas);
      if (filtro === 'ativos') return a.ativo;
      if (filtro === 'inativos') return !a.ativo;
      if (filtro === 'vencidos') return s.ordem <= 1;
      if (filtro === 'espera') return a.matriculas.some((m) => m.status === 'espera');
      return true;
    });
    el.querySelector('#contagem').textContent = `${arr.length} de ${alunos.length} aluno(s)`;
    if (!arr.length) { lista.innerHTML = vazio(alunos.length ? 'Nenhum aluno encontrado com esse filtro.' : 'Nenhum aluno cadastrado ainda. Clique em “Novo aluno”.'); return; }
    lista.innerHTML = `<div class="tabela-wrap"><table>
      <thead><tr><th>Aluno</th><th>Aulas</th><th>Plano</th><th>Situação</th><th>Cadastro</th></tr></thead>
      <tbody>${arr.map((a) => {
        const s = situacao(a.matriculas);
        const vivas = a.matriculas.filter((m) => m.status !== 'encerrada');
        return `<tr class="clicavel" data-id="${a.id}" tabindex="0">
          <td><strong>${esc(a.nome)}</strong>${a.ativo ? '' : ' <span class="badge cinza">Desativado</span>'}<br><small class="sub">${esc(a.telefone || '')}</small></td>
          <td>${vivas.length ? vivas.map((m) => `${esc(m.aulas?.nome)}${m.status === 'espera' ? ' <span class="badge alerta">espera</span>' : ''}`).join('<br>') : '—'}</td>
          <td>${vivas.length ? vivas.map((m) => planoLabel(m.plano)).join('<br>') : '—'}</td>
          <td><span class="badge ${s.cls}">${s.txt}</span></td>
          <td>${fmtDate((a.created_at || '').slice(0, 10))}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  const ir = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && (e.type === 'click' || e.key === 'Enter')) navegar(`#/alunos/${tr.dataset.id}`);
  };
  lista.addEventListener('click', ir);
  lista.addEventListener('keydown', ir);
  el.querySelector('#busca').addEventListener('input', (e) => { busca = e.target.value; desenhar(); });
  el.querySelector('#filtro').addEventListener('change', (e) => { filtro = e.target.value; desenhar(); });
  el.querySelector('#novo').addEventListener('click', () => editarAluno(null, (novo) => navegar(`#/alunos/${novo.id}`)));
  desenhar();
}

// ================================================================== CADASTRO / EDIÇÃO
export function editarAluno(aluno, aoSalvar) {
  const novo = !aluno;
  const a = aluno || {};
  const m = abrirModal({
    titulo: novo ? 'Novo aluno' : 'Editar dados do aluno',
    largura: 600,
    corpo: `
      <form id="f-aluno" novalidate>
        <label class="campo"><span>Nome completo *</span><input type="text" name="nome" required maxlength="120" value="${esc(a.nome)}"></label>
        <div class="grade2">
          <label class="campo"><span>CPF</span><input type="text" name="cpf" inputmode="numeric" maxlength="14" value="${esc(a.cpf)}"></label>
          <label class="campo"><span>Data de nascimento</span><input type="date" name="data_nascimento" max="${hojeISO()}" value="${esc(a.data_nascimento)}"></label>
          <label class="campo"><span>Telefone / WhatsApp</span><input type="tel" name="telefone" maxlength="20" value="${esc(a.telefone)}"></label>
          <label class="campo"><span>E-mail</span><input type="email" name="email" maxlength="120" inputmode="email" autocapitalize="none" value="${esc(a.email)}"><small>O aluno usa este e-mail para entrar no app.</small></label>
        </div>
        <label class="campo"><span>Responsável</span><input type="text" name="responsavel" maxlength="120" value="${esc(a.responsavel)}"><small>Para bebês e crianças.</small></label>
        <label class="campo"><span>Endereço</span><input type="text" name="endereco" maxlength="200" value="${esc(a.endereco)}"></label>
        <label class="campo"><span>Observações</span><textarea name="observacoes" maxlength="800">${esc(a.observacoes)}</textarea></label>
        <div id="a-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">${novo ? 'Cadastrar' : 'Salvar'}</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-aluno');
  const erro = (t) => { m.el.querySelector('#a-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if (!nome) return erro('Informe o nome do aluno.');
    const email = form.email.value.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return erro('E-mail inválido.');
    erro('');
    const v = (n) => form[n].value.trim() || null;
    const dados = {
      nome, cpf: v('cpf'), data_nascimento: form.data_nascimento.value || null, telefone: v('telefone'),
      email: email || null, responsavel: v('responsavel'), endereco: v('endereco'), observacoes: v('observacoes'),
    };
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const salvo = novo
          ? ok(await sb.from('alunos').insert(dados).select().single())
          : ok(await sb.from('alunos').update(dados).eq('id', a.id).select().single());
        toast(novo ? 'Aluno cadastrado.' : 'Dados atualizados.');
        m.fechar();
        aoSalvar?.(salvo);
      } catch (err) { erro(err.message); }
    });
  });
}

// ================================================================== FICHA
export async function renderFicha(el, id, { navegar }) {
  el.innerHTML = carregando('Carregando ficha…');
  let aluno, mats, pags, filas;
  try {
    aluno = ok(await sb.from('alunos').select('*').eq('id', id).maybeSingle());
    if (!aluno) { el.innerHTML = `<a class="voltar" href="#/alunos">← Alunos</a>${erroBox('Aluno não encontrado.')}`; return; }
    mats = ok(await sb.from('matriculas').select('*, aulas(id,nome), trancamentos(id,mes)')
      .eq('aluno_id', id).order('created_at', { ascending: false }));
    pags = ok(await sb.from('pagamentos').select('*, matriculas(aulas(nome))')
      .eq('aluno_id', id).order('vencimento', { ascending: false }));
    // posição na lista de espera de cada matrícula em espera
    filas = {};
    const esperas = mats.filter((m) => m.status === 'espera');
    if (esperas.length) {
      const todas = ok(await sb.from('matriculas').select('id,aula_id,created_at')
        .eq('status', 'espera').in('aula_id', esperas.map((m) => m.aula_id)).order('created_at'));
      for (const m of esperas) filas[m.id] = todas.filter((t) => t.aula_id === m.aula_id).findIndex((t) => t.id === m.id) + 1;
    }
  } catch (e) { el.innerHTML = `<a class="voltar" href="#/alunos">← Alunos</a>${erroBox(e)}`; return; }

  const recarregar = () => renderFicha(el, id, { navegar });
  const hoje = hojeISO();
  const s = situacao(mats);
  const dado = (rotulo, valor) => `<div><dt>${rotulo}</dt><dd>${valor ? esc(valor) : '—'}</dd></div>`;
  const pendentes = pags.filter((p) => p.status === 'pendente');
  const totalPago = pags.filter((p) => p.status === 'pago').reduce((t, p) => t + Number(p.valor), 0);

  el.innerHTML = `
    <a class="voltar" href="#/alunos">← Alunos</a>
    <div class="pagina-topo">
      <div>
        <h1>${esc(aluno.nome)} <span class="badge ${aluno.ativo ? 'ok' : 'cinza'}" style="vertical-align:middle">${aluno.ativo ? 'Ativo' : 'Desativado'}</span></h1>
        <p class="sub"><span class="badge ${s.cls}">${s.txt}</span> · cliente desde ${fmtDate((aluno.created_at || '').slice(0, 10))} · total pago ${money(totalPago)}
          · ${aluno.user_id ? '<span class="badge ok">Acesso ao app ativo</span>' : aluno.email ? '<span class="badge cinza">Ainda não acessou o app</span>' : '<span class="badge alerta">Sem e-mail: cadastre um para liberar o app</span>'}</p>
      </div>
      <div class="acoes-linha no-print">
        <button class="btn sec" type="button" id="editar">Editar dados</button>
        <button class="btn sec ${aluno.ativo ? 'perigo' : ''}" type="button" id="alternar">${aluno.ativo ? 'Desativar aluno' : 'Ativar aluno'}</button>
        <button class="btn" type="button" id="inscrever">＋ Inscrever em aula</button>
      </div>
    </div>

    <section class="card">
      <h2>Dados pessoais</h2>
      <dl class="dados">
        ${dado('CPF', aluno.cpf)}${dado('Nascimento', aluno.data_nascimento ? fmtDate(aluno.data_nascimento) : '')}
        ${dado('Telefone', aluno.telefone)}${dado('E-mail', aluno.email)}
        ${dado('Responsável', aluno.responsavel)}${dado('Endereço', aluno.endereco)}
        ${dado('Observações', aluno.observacoes)}
      </dl>
    </section>

    <section class="card">
      <h2>Aulas e planos</h2>
      ${mats.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Aula</th><th>Plano</th><th>Situação</th><th>Início</th><th>Pago até</th><th>Meses trancados</th><th></th></tr></thead>
        <tbody>${mats.map((m) => linhaMatricula(m, filas[m.id], hoje)).join('')}</tbody></table></div>`
        : vazio('Este aluno ainda não está inscrito em nenhuma aula.')}
    </section>

    <section class="card">
      <h2>Histórico de pagamentos ${pendentes.length ? `<span class="badge alerta">${pendentes.length} pendente(s)</span>` : ''}</h2>
      ${pags.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Referência</th><th>Aula</th><th>Plano</th><th class="num">Valor</th><th>Vencimento</th><th>Situação</th><th>Pago em</th><th>Forma</th><th></th></tr></thead>
        <tbody>${pags.map((p) => {
          const atraso = p.status === 'pendente' && p.vencimento < hoje;
          return `<tr>
            <td>${fmtMes(p.competencia)}</td><td>${esc(p.matriculas?.aulas?.nome)}</td><td>${planoLabel(p.plano)}</td>
            <td class="num">${money(p.valor)}</td><td>${fmtDate(p.vencimento)}</td>
            <td><span class="badge ${p.status === 'pago' ? 'ok' : atraso ? 'erro' : 'alerta'}">${p.status === 'pago' ? 'Pago' : atraso ? 'Em atraso' : 'Pendente'}</span></td>
            <td>${fmtDate(p.pago_em)}</td><td>${esc(p.forma || '—')}</td>
            <td class="num">${p.status === 'pendente' ? `<button class="btn pequeno" type="button" data-pagar="${p.id}">Registrar pagamento</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : vazio('Nenhum pagamento gerado ainda.')}
    </section>`;

  // ---- ações
  el.querySelector('#editar').onclick = () => editarAluno(aluno, recarregar);
  el.querySelector('#alternar').onclick = async (e) => {
    const novoEstado = !aluno.ativo;
    if (!novoEstado && !(await confirmar(`Desativar ${aluno.nome}? As matrículas continuam registradas, mas o aluno fica marcado como inativo.`, { titulo: 'Desativar aluno', confirmarTexto: 'Desativar', perigo: true }))) return;
    await comBotao(e.currentTarget, async () => {
      ok(await sb.from('alunos').update({ ativo: novoEstado }).eq('id', id));
      toast(novoEstado ? 'Aluno ativado.' : 'Aluno desativado.');
      recarregar();
    });
  };
  el.querySelector('#inscrever').onclick = () => inscrever(aluno, mats, recarregar);

  el.onclick = async (e) => {
    const pagar = e.target.closest('[data-pagar]');
    if (pagar) {
      const p = pags.find((x) => x.id === pagar.dataset.pagar);
      return registrarPagamento({ id: p.id, aluno_id: id, aluno_nome: aluno.nome, plano: p.plano, valor: p.valor, vencimento: p.vencimento }, recarregar);
    }
    const trancar = e.target.closest('[data-trancar]');
    if (trancar) return trancarMes(mats.find((m) => m.id === trancar.dataset.trancar), recarregar);
    const desfazer = e.target.closest('[data-destrancar]');
    if (desfazer) {
      if (!(await confirmar('Desfazer o trancamento deste mês? O plano volta a terminar um mês antes.', { titulo: 'Desfazer trancamento', confirmarTexto: 'Desfazer' }))) return;
      await comBotao(desfazer, async () => {
        ok(await sb.rpc('desfazer_trancamento', { p_trancamento: desfazer.dataset.destrancar }));
        toast('Trancamento desfeito.');
        recarregar();
      });
      return;
    }
    const encerrar = e.target.closest('[data-encerrar]');
    if (encerrar) {
      const m = mats.find((x) => x.id === encerrar.dataset.encerrar);
      const msg = m.status === 'espera'
        ? `Tirar ${aluno.nome} da lista de espera de ${m.aulas.nome}?`
        : `Encerrar a matrícula de ${aluno.nome} em ${m.aulas.nome}? A vaga será liberada e o próximo da lista de espera será chamado.`;
      if (!(await confirmar(msg, { titulo: 'Encerrar matrícula', confirmarTexto: 'Encerrar', perigo: true }))) return;
      await comBotao(encerrar, async () => {
        ok(await sb.rpc('encerrar_matricula', { p_matricula: m.id }));
        toast('Matrícula encerrada.');
        recarregar();
      });
    }
  };
}

function linhaMatricula(m, posicao, hoje) {
  const st = m.status === 'ativa' ? '<span class="badge ok">Ativa</span>'
    : m.status === 'espera' ? `<span class="badge alerta">Lista de espera · ${posicao}º</span>`
    : '<span class="badge cinza">Encerrada</span>';
  const trancados = [...(m.trancamentos || [])].sort((a, b) => a.mes.localeCompare(b.mes));
  const futuro = primeiroDiaMes(hoje, 1);
  const chips = trancados.length
    ? `<div class="chips">${trancados.map((t) => `<span class="chip">${fmtMes(t.mes)}${t.mes >= futuro && m.status === 'ativa' ? `<button type="button" title="Desfazer trancamento" data-destrancar="${t.id}">×</button>` : ''}</span>`).join('')}</div>` : '—';
  let pagoAte = '—';
  if (m.status === 'ativa') {
    const atraso = m.data_fim < hoje;
    pagoAte = `${fmtDate(m.data_fim)}${atraso ? ' <span class="badge erro">vencido</span>' : ''}`;
  }
  const podeTrancar = m.status === 'ativa' && m.plano !== 'mensal';
  return `<tr>
    <td><strong>${esc(m.aulas?.nome)}</strong></td>
    <td>${planoLabel(m.plano)}<br><small class="sub">${MESES_PLANO[m.plano]} mês(es)</small></td>
    <td>${st}</td>
    <td>${m.status === 'espera' ? '—' : fmtDate(m.data_inicio)}${m.data_encerramento ? `<br><small class="sub">encerrada em ${fmtDate(m.data_encerramento)}</small>` : ''}</td>
    <td>${pagoAte}</td>
    <td>${chips}</td>
    <td class="num"><div class="acoes-linha no-print">
      ${podeTrancar ? `<button class="btn sec pequeno" type="button" data-trancar="${m.id}">Trancar mês</button>` : ''}
      ${m.status !== 'encerrada' ? `<button class="btn sec perigo pequeno" type="button" data-encerrar="${m.id}">${m.status === 'espera' ? 'Sair da fila' : 'Encerrar'}</button>` : ''}
    </div></td></tr>`;
}

// ================================================================== INSCREVER
async function inscrever(aluno, mats, aoConcluir) {
  const m = abrirModal({ titulo: `Inscrever ${aluno.nome}`, largura: 540, corpo: carregando() });
  let aulas, ocupacao = {};
  try {
    aulas = ok(await sb.from('aulas').select('*').eq('ativa', true).order('ordem').order('nome'));
    const vivos = ok(await sb.from('matriculas').select('aula_id,status').in('status', ['ativa', 'espera']));
    for (const x of vivos) (ocupacao[x.aula_id] ??= { ativa: 0, espera: 0 })[x.status]++;
  } catch (e) { m.el.innerHTML = erroBox(e); return; }

  const jaEm = new Set(mats.filter((x) => x.status !== 'encerrada').map((x) => x.aula_id));
  const livres = aulas.filter((a) => !jaEm.has(a.id));
  if (!livres.length) { m.el.innerHTML = vazio('Este aluno já está inscrito (ou na fila) em todas as aulas disponíveis.'); return; }

  const preco = (a, p) => a[`preco_${p}`];
  m.el.innerHTML = `
    <form id="f-insc" novalidate>
      <label class="campo"><span>Aula</span>
        <select name="aula">${livres.map((a) => {
          const o = ocupacao[a.id] || { ativa: 0, espera: 0 };
          const cheia = o.ativa >= a.vagas;
          return `<option value="${a.id}">${esc(a.nome)} — ${cheia ? `CHEIA (fila: ${o.espera})` : `${a.vagas - o.ativa} vaga(s)`}</option>`;
        }).join('')}</select></label>
      <fieldset style="border:0;padding:0;margin:0 0 14px">
        <legend style="font-weight:600;font-size:14px;margin-bottom:6px">Plano</legend>
        <div id="planos" style="display:grid;gap:8px"></div>
      </fieldset>
      <label class="campo"><span>Início do contrato</span><input type="date" name="inicio" value="${hojeISO()}" required></label>
      <div id="aviso-vaga"></div>
      <div id="i-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-cancelar>Cancelar</button>
        <button class="btn" type="submit">Inscrever</button>
      </div>
    </form>`;
  const form = m.el.querySelector('#f-insc');
  const erro = (t) => { m.el.querySelector('#i-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();

  function atualizar() {
    const a = livres.find((x) => x.id === form.aula.value);
    const marcado = form.plano?.value || 'mensal';
    m.el.querySelector('#planos').innerHTML = Object.keys(PLANOS).map((p) => `
      <label class="check" style="margin:0;border:1.5px solid var(--borda);border-radius:10px;padding:10px 12px;font-weight:600">
        <input type="radio" name="plano" value="${p}" ${p === marcado ? 'checked' : ''}>
        ${PLANOS[p]} <span style="margin-left:auto;font-weight:700;color:var(--azul)">${preco(a, p) === null ? 'sem preço' : money(preco(a, p))}</span>
      </label>`).join('');
    const o = ocupacao[a.id] || { ativa: 0, espera: 0 };
    const cheia = o.ativa >= a.vagas || o.espera > 0;
    m.el.querySelector('#aviso-vaga').innerHTML = cheia
      ? `<div class="aviso alerta">Esta turma está cheia ou com fila: o aluno entrará na <strong>lista de espera</strong> (posição ${o.espera + 1}) e será chamado por ordem de reserva.</div>` : '';
    const semPreco = Object.keys(PLANOS).some((p) => preco(a, p) === null);
    if (semPreco) m.el.querySelector('#aviso-vaga').insertAdjacentHTML('beforeend', '<div class="aviso info">Alguns planos desta aula estão sem preço. Defina os preços na tela de Aulas antes de cobrar.</div>');
  }
  form.aula.addEventListener('change', atualizar);
  atualizar();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.inicio.value) return erro('Informe a data de início.');
    const a = livres.find((x) => x.id === form.aula.value);
    if (preco(a, form.plano.value) === null && !(await confirmar('Este plano está sem preço definido; a cobrança será gerada com valor R$ 0,00. Continuar mesmo assim?', { titulo: 'Plano sem preço', confirmarTexto: 'Continuar' }))) return;
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const r = ok(await sb.rpc('inscrever_aluno', { p_aluno: aluno.id, p_aula: form.aula.value, p_plano: form.plano.value, p_inicio: form.inicio.value }));
        m.fechar();
        toast(r.status === 'espera'
          ? `Turma cheia: ${aluno.nome} entrou na lista de espera (posição ${r.posicao_espera}).`
          : 'Aluno inscrito. A cobrança foi gerada — registre o pagamento quando receber.');
        aoConcluir();
      } catch (err) { erro(err.message); }
    });
  });
}

// ================================================================== TRANCAR
function trancarMes(mat, aoConcluir) {
  const trancados = new Set((mat.trancamentos || []).map((t) => t.mes));
  const opcoes = [];
  const ini = primeiroDiaMes(mat.data_inicio);
  for (let k = 1; k <= 24; k++) {
    const mes = primeiroDiaMes(hojeISO(), k);
    if (mes >= mat.data_fim) break;
    if (mes >= ini && !trancados.has(mes)) opcoes.push(mes);
  }
  const m = abrirModal({
    titulo: `Trancar mês — ${mat.aulas.nome}`,
    largura: 480,
    corpo: opcoes.length ? `
      <form id="f-tr" novalidate>
        <p style="margin-top:0">Só é possível trancar meses que <strong>ainda não começaram</strong> e que estejam dentro do período já pago.
          O mês trancado vai para o final do plano (o plano ganha 1 mês a mais).</p>
        <label class="campo"><span>Mês a trancar</span>
          <select name="mes">${opcoes.map((o) => `<option value="${o}">${fmtMes(o)}</option>`).join('')}</select></label>
        <div class="aviso info">Novo fim do plano: <strong id="novo-fim">${fmtDate(somaMeses(mat.data_fim, 1))}</strong> (hoje: ${fmtDate(mat.data_fim)}).</div>
        <div id="t-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Trancar mês</button>
        </div>
      </form>` : `<p>Não há meses disponíveis para trancar. É preciso que o mês ainda não tenha começado e esteja dentro do período pago
        (hoje o plano está pago até <strong>${fmtDate(mat.data_fim)}</strong>).</p>
        <div class="acoes"><button class="btn sec" type="button" data-cancelar>Fechar</button></div>`,
  });
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  const form = m.el.querySelector('#f-tr');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.rpc('trancar_mes', { p_matricula: mat.id, p_mes: form.mes.value }));
        m.fechar();
        toast('Mês trancado e movido para o final do plano.');
        aoConcluir();
      } catch (err) { m.el.querySelector('#t-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`; }
    });
  });
}
