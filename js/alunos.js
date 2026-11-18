// Alunos: lista, cadastro, ficha completa, inscrição em aulas, trancamento.
import { sb, ok, chamarCriarUsuario } from './supabase.js';
import {
  esc, money, fmtDate, fmtMes, planoLabel, PLANOS, hojeISO, diasEntre, primeiroDiaMes, abrirModal, toast,
  confirmar, comBotao, carregando, vazio, erroBox, mostrarCredenciais, linkWhatsAppPara, ICONE_WHATSAPP,
  nomeParticipante, camposParticipante, ligarParticipante, lerParticipante,
} from './ui.js';
import { registrarPagamento } from './financeiro.js';
import * as config from './config.js';

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
      .select('id,nome,email,telefone,ativo,cadastro_completo,created_at,participante_proprio,participante_nome, matriculas(id,status,plano,data_fim,aulas(nome))')
      .order('nome'));
  } catch (e) { el.innerHTML = erroBox(e); return; }

  let busca = '';
  let filtro = 'todos';

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Alunos</h1><p class="sub" id="contagem"></p></div>
      <div class="acoes-linha">
        <button class="btn sec" type="button" id="qr">QR Code do app</button>
        <button class="btn" type="button" id="novo">＋ Novo aluno</button>
      </div>
    </div>
    <div class="filtros">
      <input type="text" id="busca" placeholder="Buscar por aluno, responsável ou telefone…" aria-label="Buscar aluno">
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
      if (q && !(a.nome.toLowerCase().includes(q) || nomeParticipante(a).toLowerCase().includes(q) ||(a.telefone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§'))) return false;
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
          <td><strong>${esc(nomeParticipante(a))}</strong>${nomeParticipante(a) !== a.nome ? `<br><small class="sub">resp.: ${esc(a.nome)}</small>` : ''}${a.ativo ? '' : ' <span class="badge cinza">Desativado</span>'}${a.cadastro_completo === false ? ' <span class="badge alerta">Aguardando 1º acesso</span>' : ''}<br><small class="sub">${esc(a.telefone || '')}</small></td>
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
  el.querySelector('#novo').addEventListener('click', () => novoAluno(navegar));
  el.querySelector('#qr').addEventListener('click', abrirQrCode);
  desenhar();
}

// ================================================================== QR CODE DO APP
export async function abrirQrCode() {
  const url = config.APP_URL || `${location.origin}${location.pathname}`;
  const m = abrirModal({ titulo: 'QR Code do app', largura: 420, corpo: carregando('Gerando QR Code…') });
  let qr;
  try {
    const { default: qrcode } = await import('https://esm.sh/qrcode-generator@1.4.4');
    qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
  } catch {
    m.el.innerHTML = erroBox('Não foi possível gerar o QR Code. Verifique a internet e tente de novo.');
    return;
  }

  // Desenha em canvas (nítido em qualquer tela e pode ser baixado como PNG).
  const n = qr.getModuleCount();
  const margem = 4;
  const celula = 10;
  const lado = (n + margem * 2) * celula;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = lado;
  canvas.className = 'qr-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `QR Code para ${url}`);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, lado, lado);
  ctx.fillStyle = '#0d2438';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margem) * celula, (r + margem) * celula, celula, celula);
    }
  }

  const podeCompartilhar = typeof navigator.share === 'function';
  m.el.innerHTML = `
    <p class="sub" style="text-align:center;margin:0 0 12px">Peça para o aluno apontar a câmera do celular para o código.</p>
    <div class="qr-box"></div>
    <p class="qr-url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>
    <div class="acoes qr-acoes">
      <button class="btn sec" type="button" data-copiar>Copiar link</button>
      <button class="btn sec" type="button" data-baixar>Baixar imagem</button>
      ${podeCompartilhar ? '<button class="btn" type="button" data-compartilhar>Compartilhar</button>' : ''}
    </div>`;
  m.el.querySelector('.qr-box').appendChild(canvas);

  m.el.querySelector('[data-copiar]').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copiado.'); } catch { toast('Não foi possível copiar. Copie o link acima.', 'erro'); }
  };
  m.el.querySelector('[data-baixar]').onclick = () => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'qrcode-app-cevisa.png';
    a.click();
  };
  m.el.querySelector('[data-compartilhar]')?.addEventListener('click', async () => {
    try {
      await navigator.share({ title: 'App Cevisa', text: 'Acesse o app do Spa Médico Adventista Cevisa:', url });
    } catch { /* usuário cancelou */ }
  });
}

// ================================================================== NOVO ALUNO (só e-mail + senha temporária)
// professor: true → sem cadastro manual e sem abrir a ficha (o professor não acessa fichas); chama aoCriar no fim.
export function novoAluno(navegar, { professor = false, aoCriar } = {}) {
  const m = abrirModal({
    titulo: 'Novo aluno',
    largura: 460,
    corpo: `
      <form id="f-novo" novalidate>
        <label class="campo"><span>E-mail do aluno *</span><input type="email" name="email" maxlength="120" inputmode="email" autocapitalize="none" autocomplete="off" required>
          <small>Para crianças e bebês, use o e-mail do responsável.</small></label>
        <div class="aviso info">O app vai gerar uma <strong>senha temporária</strong> para você passar ao aluno. No primeiro acesso ele cria a própria senha e completa o cadastro.</div>
        <div id="n-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Criar acesso</button>
        </div>
        ${professor ? '<p class="login-troca">Depois, a recepção faz a inscrição do aluno na aula e na turma.</p>'
          : '<p class="login-troca">Aluno sem e-mail? <button type="button" class="link" data-manual>Cadastrar sem acesso ao app</button></p>'}
      </form>`,
  });
  const form = m.el.querySelector('#f-novo');
  const erro = (t) => { m.el.querySelector('#n-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  m.el.querySelector('[data-manual]')?.addEventListener('click', () => { m.fechar(); editarAluno(null, (novo) => navegar(`#/alunos/${novo.id}`)); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return erro('Informe um e-mail válido.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const r = await chamarCriarUsuario({ acao: 'criar_aluno', email });
        m.fechar();
        if (professor) {
          aoCriar?.();
          mostrarCredenciais({ email: r.email, senha: r.senha });
          return;
        }
        navegar(`#/alunos/${r.aluno_id}`);
        setTimeout(() => mostrarCredenciais({ email: r.email, senha: r.senha }), 400);
      } catch (err) { erro(err.message); }
    });
  });
}

// ================================================================== EXCLUIR (permanente)
function excluirAluno(aluno, mats, aoExcluir) {
  const ativas = mats.filter((x) => x.status === 'ativa').length;
  const m = abrirModal({
    titulo: 'Excluir aluno',
    largura: 460,
    corpo: `
      <form id="f-excluir" novalidate>
        <div class="aviso erro" style="margin-top:0">Você vai excluir <strong>${esc(aluno.nome)}</strong> para sempre.</div>
        <ul style="margin:0 0 14px;padding-left:20px">
          <li>Ficha e dados pessoais</li>
          <li>${mats.length} matrícula(s)${ativas ? ` — ${ativas} vaga(s) será(ão) liberada(s) para a lista de espera` : ''}</li>
          <li>Todo o histórico de pagamentos (some dos relatórios)</li>
          ${aluno.user_id ? '<li>O acesso do aluno ao app</li>' : ''}
        </ul>
        <label class="campo"><span>Para confirmar, digite <strong>EXCLUIR</strong></span>
          <input type="text" name="confirma" autocomplete="off" autocapitalize="characters"></label>
        <div id="ex-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn perigo" type="submit" disabled>Excluir para sempre</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-excluir');
  const btn = form.querySelector('[type=submit]');
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.confirma.addEventListener('input', () => { btn.disabled = form.confirma.value.trim().toUpperCase() !== 'EXCLUIR'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.confirma.value.trim().toUpperCase() !== 'EXCLUIR') return;
    await comBotao(btn, async () => {
      try {
        ok(await sb.rpc('excluir_aluno', { p_aluno: aluno.id }));
        m.fechar();
        toast(`${aluno.nome} foi excluído(a).`);
        aoExcluir();
      } catch (err) {
        m.el.querySelector('#ex-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
      }
    });
  });
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
        <label class="campo"><span>Nome completo do responsável *</span><input type="text" name="nome" required maxlength="120" value="${esc(a.nome)}"><small>Titular do cadastro: tem o acesso ao app e cuida dos pagamentos.</small></label>
        <div class="grade2">
          <label class="campo"><span>CPF</span><input type="text" name="cpf" inputmode="numeric" maxlength="14" value="${esc(a.cpf)}"></label>
          <label class="campo"><span>Data de nascimento</span><input type="date" name="data_nascimento" max="${hojeISO()}" value="${esc(a.data_nascimento)}"></label>
          <label class="campo"><span>Telefone / WhatsApp</span><input type="tel" name="telefone" maxlength="20" value="${esc(a.telefone)}"></label>
          <label class="campo"><span>E-mail</span><input type="email" name="email" maxlength="120" inputmode="email" autocapitalize="none" value="${esc(a.email)}"><small>É o login do aluno no app. Se trocar, o acesso atual é desligado e será preciso usar “Criar acesso ao app” na ficha.</small></label>
        </div>
        ${camposParticipante(a)}
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
  ligarParticipante(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if (!nome) return erro('Informe o nome do responsável.');
    const email = form.email.value.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return erro('E-mail inválido.');
    let part;
    try { part = lerParticipante(form); } catch (err) { return erro(err.message); }
    erro('');
    const v = (n) => form[n].value.trim() || null;
    const dados = {
      nome, cpf: v('cpf'), data_nascimento: form.data_nascimento.value || null, telefone: v('telefone'),
      email: email || null, endereco: v('endereco'), observacoes: v('observacoes'),
      participante_proprio: part.proprio, participante_nome: part.nome, participante_nascimento: part.nascimento,
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
  let aluno, mats, pags, filas, pedidos = [], comprovantes = [], turmasPorAula = {};
  try {
    aluno = ok(await sb.from('alunos').select('*').eq('id', id).maybeSingle());
    if (!aluno) { el.innerHTML = `<a class="voltar" href="#/alunos">← Alunos</a>${erroBox('Aluno não encontrado.')}`; return; }
    mats = ok(await sb.from('matriculas').select('*, aulas(id,nome), turmas(id,nome), trancamentos(id,mes)')
      .eq('aluno_id', id).order('created_at', { ascending: false }));
    pags = ok(await sb.from('pagamentos').select('*, matriculas(aulas(nome))')
      .eq('aluno_id', id).order('vencimento', { ascending: false }));
    // pedidos de inscrição feitos pelo aluno no app (ignora erro se o banco ainda não tiver a tabela)
    const rp = await sb.from('solicitacoes_inscricao').select('id,aula_id,turma_id,plano,observacao,created_at,aulas(nome),turmas(nome)')
      .eq('aluno_id', id).eq('status', 'pendente').order('created_at');
    pedidos = rp.error ? [] : rp.data;
    // comprovantes enviados pelo aluno (links temporários para abrir o arquivo)
    const rc = await sb.from('comprovantes').select('id,arquivo,nome_arquivo,observacao,created_at').eq('aluno_id', id)
      .order('created_at', { ascending: false }).limit(20);
    comprovantes = rc.error ? [] : rc.data;
    if (comprovantes.length) {
      const rs = await sb.storage.from('comprovantes').createSignedUrls(comprovantes.map((c) => c.arquivo), 3600);
      for (const c of comprovantes) c.url = rs.data?.find((x) => x.path === c.arquivo)?.signedUrl || null;
    }
    // turmas das aulas do aluno (para trocar de turma)
    const aulasIds = [...new Set(mats.filter((m) => m.status !== 'encerrada').map((m) => m.aula_id))];
    if (aulasIds.length) {
      const rt = await sb.from('turmas').select('id,aula_id,nome,vagas,ativa').in('aula_id', aulasIds).order('ordem').order('nome');
      for (const t of rt.error ? [] : rt.data) (turmasPorAula[t.aula_id] ??= []).push(t);
    }
    // posição na lista de espera de cada matrícula em espera
    filas = {};
    const esperas = mats.filter((m) => m.status === 'espera');
    if (esperas.length) {
      const todas = ok(await sb.from('matriculas').select('id,aula_id,turma_id,created_at')
        .eq('status', 'espera').in('aula_id', esperas.map((m) => m.aula_id)).order('created_at'));
      for (const m of esperas) {
        filas[m.id] = todas.filter((t) => t.aula_id === m.aula_id && t.turma_id === m.turma_id).findIndex((t) => t.id === m.id) + 1;
      }
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
        ${nomeParticipante(aluno) !== aluno.nome ? `<p class="participante-linha">Faz as aulas: <strong>${esc(nomeParticipante(aluno))}</strong> · ${esc(aluno.nome)} é o(a) responsável</p>` : ''}
        <p class="sub"><span class="badge ${s.cls}">${s.txt}</span> · cliente desde ${fmtDate((aluno.created_at || '').slice(0, 10))} · total pago ${money(totalPago)}
          · ${aluno.user_id && aluno.cadastro_completo === false ? '<span class="badge alerta">Aguardando 1º acesso do aluno</span>' : aluno.user_id ? '<span class="badge ok">Acesso ao app ativo</span>' : aluno.email ? '<span class="badge cinza">Ainda não acessou o app</span>' : '<span class="badge alerta">Sem e-mail: cadastre um para liberar o app</span>'}</p>
      </div>
      <div class="acoes-linha no-print">
        <a class="btn whats" id="mensagem" target="_blank" rel="noopener"
          href="${esc(linkWhatsAppPara(aluno.telefone, `Olá, ${aluno.nome.split(' ')[0]}! Aqui é do Spa Médico Adventista Cevisa.`) || '#')}">${ICONE_WHATSAPP}Enviar mensagem</a>
        <button class="btn sec" type="button" id="editar">Editar dados</button>
        ${aluno.user_id ? '<button class="btn sec" type="button" id="nova-senha">Gerar nova senha</button>' : aluno.email ? '<button class="btn sec" type="button" id="criar-acesso">Criar acesso ao app</button>' : ''}
        <button class="btn sec ${aluno.ativo ? 'perigo' : ''}" type="button" id="alternar">${aluno.ativo ? 'Desativar aluno' : 'Ativar aluno'}</button>
        <button class="btn" type="button" id="inscrever">＋ Inscrever em aula</button>
      </div>
    </div>

    ${pedidos.length ? `
    <section class="card pedidos no-print">
      <h2>Pedidos de inscrição pelo app <span class="badge alerta">${pedidos.length}</span></h2>
      <ul class="lista-equipe">${pedidos.map((p) => `
        <li>
          <div><strong>${esc(p.aulas?.nome)}${p.turmas?.nome ? ` — ${esc(p.turmas.nome)}` : ''}</strong> · plano ${planoLabel(p.plano)}
            <small>pedido em ${fmtDate(p.created_at.slice(0, 10))}${p.observacao ? ` · “${esc(p.observacao)}”` : ''}</small></div>
          <div class="acoes-linha">
            <button class="btn sec perigo pequeno" type="button" data-recusar-pedido="${p.id}">Recusar</button>
            <button class="btn pequeno" type="button" data-aceitar-pedido="${p.id}">Inscrever agora</button>
          </div>
        </li>`).join('')}</ul>
    </section>` : ''}

    <section class="card">
      <h2>Dados pessoais</h2>
      <dl class="dados">
        ${dado('CPF', aluno.cpf)}${dado('Nascimento', aluno.data_nascimento ? fmtDate(aluno.data_nascimento) : '')}
        ${dado('Telefone', aluno.telefone)}${dado('E-mail', aluno.email)}
        ${dado('Quem faz as aulas', aluno.participante_proprio === false
          ? `${nomeParticipante(aluno)}${aluno.participante_nascimento ? ` (nasc. ${fmtDate(aluno.participante_nascimento)})` : ''}`
          : 'O próprio responsável')}
        ${aluno.responsavel ? dado('Responsável (cadastro antigo)', aluno.responsavel) : ''}${dado('Endereço', aluno.endereco)}
        ${dado('Observações', aluno.observacoes)}
      </dl>
    </section>

    <section class="card">
      <h2>Aulas e planos</h2>
      ${mats.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Aula</th><th>Plano</th><th>Situação</th><th>Início</th><th>Pago até</th><th>Meses trancados</th><th></th></tr></thead>
        <tbody>${mats.map((m) => linhaMatricula(m, filas[m.id], hoje, turmasPorAula[m.aula_id])).join('')}</tbody></table></div>`
        : vazio('Este aluno ainda não está inscrito em nenhuma aula.')}
    </section>

    ${comprovantes.length ? `
    <section class="card">
      <h2>Comprovantes enviados pelo aluno</h2>
      <ul class="lista-equipe">${comprovantes.map((c) => `
        <li>
          <div><strong>${fmtDate(c.created_at.slice(0, 10))}</strong> · ${esc(c.nome_arquivo || 'arquivo')}
            ${c.observacao ? `<small>“${esc(c.observacao)}”</small>` : ''}</div>
          ${c.url ? `<a class="btn sec pequeno" href="${esc(c.url)}" target="_blank" rel="noopener">Ver comprovante</a>` : ''}
        </li>`).join('')}</ul>
    </section>` : ''}

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
    </section>

    <section class="card zona-perigo no-print">
      <h2>Excluir aluno</h2>
      <p class="sub" style="margin:0 0 14px">Apaga <strong>permanentemente</strong> a ficha, as matrículas, o histórico de pagamentos e o acesso ao app.
        Isso não pode ser desfeito e os pagamentos deixam de aparecer nos relatórios. Para só pausar, use “Desativar aluno”.</p>
      <button class="btn perigo" type="button" id="excluir">Excluir aluno permanentemente</button>
    </section>`;

  // ---- ações
  el.querySelector('#mensagem').addEventListener('click', (e) => {
    if (e.currentTarget.getAttribute('href') !== '#') return;
    e.preventDefault();
    toast(aluno.telefone ? 'O telefone deste aluno parece incompleto. Confira o DDD em “Editar dados”.' : 'Este aluno não tem telefone cadastrado. Adicione em “Editar dados”.', 'erro');
  });
  el.querySelector('#excluir').onclick =() => excluirAluno(aluno, mats, () => navegar('#/alunos'));
  el.querySelector('#editar').onclick = () => editarAluno(aluno, recarregar);
  el.querySelector('#nova-senha')?.addEventListener('click', async (e) => {
    if (!(await confirmar(`Gerar uma nova senha temporária para ${aluno.nome}? A senha atual dele deixa de funcionar.`, { titulo: 'Nova senha', confirmarTexto: 'Gerar nova senha' }))) return;
    await comBotao(e.currentTarget, async () => {
      const r = await chamarCriarUsuario({ acao: 'nova_senha', user_id: aluno.user_id });
      mostrarCredenciais({ titulo: 'Nova senha temporária', email: r.email || aluno.email, senha: r.senha });
    });
  });
  el.querySelector('#criar-acesso')?.addEventListener('click', async (e) => {
    await comBotao(e.currentTarget, async () => {
      const r = await chamarCriarUsuario({ acao: 'criar_aluno', email: aluno.email });
      recarregar();
      mostrarCredenciais({ email: r.email, senha: r.senha });
    });
  });
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
  el.querySelectorAll('[data-aceitar-pedido]').forEach((b) => {
    b.onclick = () => {
      const p = pedidos.find((x) => x.id === b.dataset.aceitarPedido);
      inscrever(aluno, mats, recarregar, { aula_id: p.aula_id, plano: p.plano, turma_id: p.turma_id });
    };
  });
  el.querySelectorAll('[data-recusar-pedido]').forEach((b) => {
    b.onclick = async () => {
      const p = pedidos.find((x) => x.id === b.dataset.recusarPedido);
      if (!(await confirmar(`Recusar o pedido de ${aluno.nome} para ${p.aulas?.nome}? Lembre-se de avisar o aluno.`, { titulo: 'Recusar pedido', confirmarTexto: 'Recusar', perigo: true }))) return;
      await comBotao(b, async () => {
        ok(await sb.rpc('recusar_solicitacao', { p_solicitacao: p.id }));
        toast('Pedido recusado.');
        recarregar();
      });
    };
  });

  el.onclick = async (e) => {
    const pagar = e.target.closest('[data-pagar]');
    if (pagar) {
      const p = pags.find((x) => x.id === pagar.dataset.pagar);
      return registrarPagamento({ id: p.id, aluno_id: id, aluno_nome: aluno.nome, plano: p.plano, valor: p.valor, vencimento: p.vencimento }, recarregar);
    }
    const troca = e.target.closest('[data-trocar-turma]');
    if (troca) {
      const mt = mats.find((x) => x.id === troca.dataset.trocarTurma);
      return trocarTurma(mt, turmasPorAula[mt.aula_id] || [], recarregar);
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

function linhaMatricula(m, posicao, hoje, turmas = []) {
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
    <td><strong>${esc(m.aulas?.nome)}</strong>${m.turmas?.nome ? `<br><small class="sub">${esc(m.turmas.nome)}</small>`
      : turmas.length && m.status !== 'encerrada' ? '<br><span class="badge alerta">sem turma</span>' : ''}</td>
    <td>${planoLabel(m.plano)}<br><small class="sub">${MESES_PLANO[m.plano]} mês(es)</small></td>
    <td>${st}</td>
    <td>${m.status === 'espera' ? '—' : fmtDate(m.data_inicio)}${m.data_encerramento ? `<br><small class="sub">encerrada em ${fmtDate(m.data_encerramento)}</small>` : ''}</td>
    <td>${pagoAte}</td>
    <td>${chips}</td>
    <td class="num"><div class="acoes-linha no-print">
      ${turmas.length && m.status !== 'encerrada' ? `<button class="btn sec pequeno" type="button" data-trocar-turma="${m.id}">Trocar turma</button>` : ''}
      ${podeTrancar ? `<button class="btn sec pequeno" type="button" data-trancar="${m.id}">Trancar mês</button>` : ''}
      ${m.status !== 'encerrada' ? `<button class="btn sec perigo pequeno" type="button" data-encerrar="${m.id}">${m.status === 'espera' ? 'Sair da fila' : 'Encerrar'}</button>` : ''}
    </div></td></tr>`;
}

// ================================================================== INSCREVER
async function inscrever(aluno, mats, aoConcluir, preset = {}) {
  // preset: aula e plano escolhidos pelo aluno num pedido de inscrição feito pelo app
  const m = abrirModal({ titulo: `Inscrever ${nomeParticipante(aluno)}`, largura: 540, corpo: carregando() });
  let aulas, turmas = [];
  const ocupacao = {};   // chave: id da turma, ou id da aula para quem está sem turma
  try {
    aulas = ok(await sb.from('aulas').select('*').eq('ativa', true).order('ordem').order('nome'));
    const vivos = ok(await sb.from('matriculas').select('aula_id,turma_id,status').in('status', ['ativa', 'espera']));
    for (const x of vivos) (ocupacao[x.turma_id || x.aula_id] ??= { ativa: 0, espera: 0 })[x.status]++;
    const rt = await sb.from('turmas').select('*').eq('ativa', true).order('ordem').order('nome');
    turmas = rt.error ? [] : rt.data;
  } catch (e) { m.el.innerHTML = erroBox(e); return; }
  const turmasDa = (aulaId) => turmas.filter((t) => t.aula_id === aulaId);
  // vagas/ocupação do grupo escolhido: a turma, ou a aula inteira se ela não tem turmas
  const grupo = (a, turmaId) => {
    const t = turmaId && turmas.find((x) => x.id === turmaId);
    return { vagas: t ? t.vagas : a.vagas, ...(ocupacao[t ? t.id : a.id] || { ativa: 0, espera: 0 }) };
  };

  const jaEm = new Set(mats.filter((x) => x.status !== 'encerrada').map((x) => x.aula_id));
  const livres = aulas.filter((a) => !jaEm.has(a.id));
  if (!livres.length) { m.el.innerHTML = vazio('Este aluno já está inscrito (ou na fila) em todas as aulas disponíveis.'); return; }

  const preco = (a, p) => a[`preco_${p}`];
  m.el.innerHTML = `
    <form id="f-insc" novalidate>
      <label class="campo"><span>Aula</span>
        <select name="aula">${livres.map((a) => {
          const ts = turmasDa(a.id);
          let rotulo;
          if (ts.length) {
            const vagas = ts.reduce((s, t) => s + Math.max(0, t.vagas - grupo(a, t.id).ativa), 0);
            rotulo = `${ts.length} turma(s) · ${vagas ? `${vagas} vaga(s)` : 'TODAS CHEIAS'}`;
          } else {
            const o = grupo(a, null);
            rotulo = o.ativa >= o.vagas ? `CHEIA (fila: ${o.espera})` : `${o.vagas - o.ativa} vaga(s)`;
          }
          return `<option value="${a.id}" ${a.id === preset.aula_id ? 'selected' : ''}>${esc(a.nome)} — ${rotulo}</option>`;
        }).join('')}</select></label>
      <div id="campo-turma"></div>
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

  function desenharTurmas() {
    const a = livres.find((x) => x.id === form.aula.value);
    const ts = turmasDa(a.id);
    const escolhida = ts.find((t) => t.id === preset.turma_id) || ts.find((t) => grupo(a, t.id).ativa < t.vagas) || ts[0];
    m.el.querySelector('#campo-turma').innerHTML = ts.length ? `
      <label class="campo"><span>Turma</span>
        <select name="turma">${ts.map((t) => {
          const o = grupo(a, t.id);
          return `<option value="${t.id}" ${t === escolhida ? 'selected' : ''}>${esc(t.nome)} — ${o.ativa >= t.vagas ? `CHEIA (fila: ${o.espera})` : `${t.vagas - o.ativa} vaga(s)`}</option>`;
        }).join('')}</select></label>` : '';
    form.turma?.addEventListener('change', atualizar);
  }

  function atualizar() {
    const a = livres.find((x) => x.id === form.aula.value);
    const marcado = form.plano?.value || preset.plano || 'mensal';
    m.el.querySelector('#planos').innerHTML = Object.keys(PLANOS).map((p) => `
      <label class="check" style="margin:0;border:1.5px solid var(--borda);border-radius:10px;padding:10px 12px;font-weight:600">
        <input type="radio" name="plano" value="${p}" ${p === marcado ? 'checked' : ''}>
        ${PLANOS[p]} <span style="margin-left:auto;font-weight:700;color:var(--azul)">${preco(a, p) === null ? 'sem preço' : money(preco(a, p))}</span>
      </label>`).join('');
    const o = grupo(a, form.turma?.value || null);
    const cheia = o.ativa >= o.vagas || o.espera > 0;
    m.el.querySelector('#aviso-vaga').innerHTML = cheia
      ? `<div class="aviso alerta">Esta turma está cheia ou com fila: o aluno entrará na <strong>lista de espera</strong> (posição ${o.espera + 1}) e será chamado por ordem de reserva.</div>` : '';
    const semPreco = Object.keys(PLANOS).some((p) => preco(a, p) === null);
    if (semPreco) m.el.querySelector('#aviso-vaga').insertAdjacentHTML('beforeend', '<div class="aviso info">Alguns planos desta aula estão sem preço. Defina os preços na tela de Aulas antes de cobrar.</div>');
  }
  if (preset.aula_id && !livres.some((a) => a.id === preset.aula_id)) {
    m.el.querySelector('#aviso-vaga').insertAdjacentHTML('beforebegin', '<div class="aviso alerta">A aula pedida pelo aluno não está disponível (oculta ou já inscrito). Escolha outra ou recuse o pedido.</div>');
  }
  form.aula.addEventListener('change', () => { desenharTurmas(); atualizar(); });
  desenharTurmas();
  atualizar();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.inicio.value) return erro('Informe a data de início.');
    const a = livres.find((x) => x.id === form.aula.value);
    if (preco(a, form.plano.value) === null && !(await confirmar('Este plano está sem preço definido; a cobrança será gerada com valor R$ 0,00. Continuar mesmo assim?', { titulo: 'Plano sem preço', confirmarTexto: 'Continuar' }))) return;
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const args = { p_aluno: aluno.id, p_aula: form.aula.value, p_plano: form.plano.value, p_inicio: form.inicio.value };
        if (form.turma?.value) args.p_turma = form.turma.value;
        const r = ok(await sb.rpc('inscrever_aluno', args));
        m.fechar();
        toast(r.status === 'espera'
          ? `Turma cheia: ${aluno.nome} entrou na lista de espera (posição ${r.posicao_espera}).`
          : 'Aluno inscrito. A cobrança foi gerada — registre o pagamento quando receber.');
        aoConcluir();
      } catch (err) { erro(err.message); }
    });
  });
}

// ================================================================== TROCAR TURMA
async function trocarTurma(mat, turmas, aoConcluir) {
  const m = abrirModal({ titulo: `Trocar turma — ${mat.aulas.nome}`, largura: 460, corpo: carregando() });
  const oc = {};
  try {
    const vivos = ok(await sb.from('matriculas').select('turma_id').eq('aula_id', mat.aula_id).eq('status', 'ativa'));
    for (const x of vivos) if (x.turma_id) oc[x.turma_id] = (oc[x.turma_id] || 0) + 1;
  } catch (e) { m.el.innerHTML = erroBox(e); return; }
  m.el.innerHTML = `
    <form id="f-troca" novalidate>
      <label class="campo"><span>Nova turma</span>
        <select name="turma">${turmas.map((t) => {
          const atual = t.id === mat.turma_id;
          const cheia = (oc[t.id] || 0) >= t.vagas;
          return `<option value="${t.id}" ${atual ? 'selected' : ''}>${esc(t.nome)} — ${atual ? 'turma atual' : cheia ? 'CHEIA' : `${t.vagas - (oc[t.id] || 0)} vaga(s)`}${t.ativa ? '' : ' (oculta)'}</option>`;
        }).join('')}</select></label>
      ${mat.status === 'espera' ? '<div class="aviso info">O aluno está na lista de espera: ele passa para a fila da nova turma.</div>' : '<div class="aviso info">A vaga na turma atual é liberada para a lista de espera dela.</div>'}
      <div id="tt-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-cancelar>Cancelar</button>
        <button class="btn" type="submit">Trocar</button>
      </div>
    </form>`;
  const form = m.el.querySelector('#f-troca');
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.rpc('mudar_turma', { p_matricula: mat.id, p_turma: form.turma.value }));
        m.fechar();
        toast('Turma alterada.');
        aoConcluir();
      } catch (err) { m.el.querySelector('#tt-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`; }
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
