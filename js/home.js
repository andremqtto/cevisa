// Tela inicial: aulas, turmas e preços (pública). Gestores editam tudo aqui.
import { sb, ok } from './supabase.js';
import { avatarHTML, ativarFotos } from './fotos.js';
import { esc, money, abrirModal, toast, confirmar, comBotao, carregando, vazio, erroBox, planoLabel, horariosHTML, nomeParticipante } from './ui.js';

const FOTO_MAX = 5 * 1024 * 1024;

export async function renderHome(el, { isGestor, logado = false }) {
  el.innerHTML = carregando('Carregando aulas…');
  try {
    let aulas, turmas = [];
    const ocupacao = {};   // por aula: { ativa, espera } das matrículas SEM turma
    const ocTurma = {};    // por turma: { ativa, espera }
    if (isGestor) {
      aulas = ok(await sb.from('aulas').select('*').order('ordem').order('nome'));
      const mats = ok(await sb.from('matriculas').select('aula_id,turma_id,status').in('status', ['ativa', 'espera']));
      for (const m of mats) {
        const o = m.turma_id ? (ocTurma[m.turma_id] ??= { ativa: 0, espera: 0 }) : (ocupacao[m.aula_id] ??= { ativa: 0, espera: 0 });
        o[m.status]++;
      }
      const rt = await sb.from('turmas').select('*').order('ordem').order('nome');
      turmas = rt.error ? [] : rt.data;   // banco ainda sem turmas: segue sem elas
    } else {
      aulas = ok(await sb.from('aulas_publicas').select('*'));
      const rt = await sb.from('turmas_publicas').select('*');
      turmas = rt.error ? [] : rt.data;
    }
    const turmasDa = (id) => turmas.filter((t) => t.aula_id === id);
    // Aluno logado: saber em quais aulas já está inscrito ou já pediu inscrição.
    let alunos = null;
    if (logado) {
      const r = await sb.rpc('painel_aluno');
      alunos = r.error ? null : r.data;
    }
    desenhar(el, aulas, { isGestor, logado, alunos, ocupacao, ocTurma, turmasDa });
  } catch (e) {
    el.innerHTML = erroBox(e);
  }
}

function desenhar(el, aulas, ctx) {
  const { isGestor } = ctx;
  const recarregar = () => renderHome(el, { isGestor, logado: ctx.logado });
  el.innerHTML = `
    <section class="hero">
      <h1>Nossas aulas</h1>
      <p class="sub">Conheça as modalidades do Spa Médico Adventista Cevisa e escolha a sua.</p>
    </section>
    ${isGestor ? '<div class="aviso info no-print">Você está logado como gestor: pode editar as aulas, turmas, preços e fotos. As vagas só aparecem para você.</div>' : ''}
    <div class="grade-aulas">
      ${aulas.map((a) => cartao(a, ctx)).join('')}
      ${isGestor ? '<button class="nova-aula" data-nova type="button">＋ Nova aula</button>' : ''}
    </div>
    ${!aulas.length && !isGestor ? vazio('Em breve, novas aulas por aqui.') : ''}
    ${!isGestor && !ctx.alunos ? '<p class="sub" style="margin-top:28px">Para se inscrever, procure a recepção do Spa Médico Adventista Cevisa ou entre no app.</p>' : ''}`;

  el.onclick = async (e) => {
    const pedir = e.target.closest('[data-pedir]');
    if (pedir) {
      const aula = aulas.find((a) => a.id === pedir.dataset.pedir);
      const { abrirPedidoInscricao } = await import('./aluno.js');
      return abrirPedidoInscricao(aula, ctx.turmasDa(aula.id), ctx.alunos, recarregar);
    }
    const b = e.target.closest('[data-nova],[data-editar],[data-turma],[data-turmas]');
    if (!b) return;
    if (b.hasAttribute('data-nova')) return editarAula(null, recarregar);
    const aula = aulas.find((a) => a.id === (b.dataset.editar || b.dataset.turma || b.dataset.turmas));
    if (b.dataset.editar) editarAula(aula, recarregar);
    else if (b.dataset.turmas) gerenciarTurmas(aula, recarregar);
    else verAlunos(aula, ctx.turmasDa(aula.id));
  };
}

function precoBox(rotulo, valor, meses, extra = '') {
  // semestral: "6x R$ …" (parcelas); anual: equivalente por mês
  const porMes = !valor || meses <= 1 ? '' : meses === 6 ? `6x ${money(valor / 6)}` : `${money(valor / meses)}/mês`;
  return `<div class="preco ${extra}"><span>${rotulo}</span><strong>${valor === null || valor === undefined ? 'Consulte' : money(valor)}</strong><small>${porMes}</small></div>`;
}

/** Aula sem vaga para novos alunos? (todas as turmas cheias, ou a aula cheia se não tiver turmas) */
const aulaLotada = (a, turmas) => (turmas.length ? turmas.every((t) => t.lotada) : !!a.lotada);

/** Situação do aluno (ou alunos do mesmo responsável) nesta aula: botão de inscrição/fila ou selo. */
function inscricaoAluno(a, turmas, alunos) {
  if (!alunos) return '';
  const estados = alunos.map((al) => {
    const m = al.matriculas.find((x) => x.aula_id === a.id);
    if (m) return m.status === 'espera' ? 'espera' : 'inscrito';
    return al.solicitacoes?.some((s) => s.aula_id === a.id) ? 'pedido' : 'livre';
  });
  if (estados.includes('livre')) {
    return aulaLotada(a, turmas)
      ? `<button class="btn amarelo largo" type="button" data-pedir="${a.id}">Fila de espera</button>`
      : `<button class="btn largo" type="button" data-pedir="${a.id}">Fazer inscrição</button>`;
  }
  const selo = { inscrito: ['ok', 'Você está inscrito(a)'], espera: ['alerta', 'Você está na lista de espera'], pedido: ['alerta', 'Pedido enviado · aguardando a recepção'] }[estados[0]];
  return `<div class="inscricao-selo"><span class="badge ${selo[0]}">${selo[1]}</span></div>`;
}

/** Turmas no cartão: nome, horários e características. Gestor vê as vagas de cada uma. */
function turmasHTML(turmas, ctx) {
  return `<div class="turmas-lista">${turmas.map((t) => {
    const o = ctx.ocTurma[t.id] || { ativa: 0, espera: 0 };
    const lotada = ctx.isGestor ? o.ativa >= t.vagas : t.lotada;
    const info = ctx.isGestor
      ? `<span class="badge ${lotada ? 'erro' : 'ok'}">${o.ativa}/${t.vagas}</span>${o.espera ? ` <span class="badge alerta">${o.espera} na fila</span>` : ''}${t.ativa ? '' : ' <span class="badge cinza">Oculta</span>'}`
      : lotada ? '<span class="badge cinza">Sem vagas</span>' : '';
    return `
      <div class="turma-item ${lotada && !ctx.isGestor ? 'lotada' : ''}">
        <div class="turma-nome"><strong>${esc(t.nome)}</strong><span>${info}</span></div>
        ${horariosHTML(t.horarios)}
        ${t.descricao ? `<small>${esc(t.descricao)}</small>` : ''}
      </div>`;
  }).join('')}</div>`;
}

function cartao(a, ctx) {
  const { isGestor } = ctx;
  const turmas = ctx.turmasDa(a.id);
  const foto = a.foto_url
    ? `<img src="${esc(a.foto_url)}" alt="Foto da aula de ${esc(a.nome)}" loading="lazy">`
    : `<span class="inicial" aria-hidden="true">${esc(a.nome.charAt(0))}</span>`;
  const o = ctx.ocupacao[a.id] || { ativa: 0, espera: 0 };
  const cheia = isGestor && o.ativa >= a.vagas;
  return `
    <article class="aula ${isGestor && !a.ativa ? 'oculta' : ''}">
      <div class="aula-foto">${foto}${isGestor && !a.ativa ? '<span class="selo">Oculta ao público</span>' : ''}</div>
      <div class="aula-corpo">
        <h2>${esc(a.nome)}</h2>
        ${a.descricao ? `<p>${esc(a.descricao)}</p>` : ''}
        ${turmas.length ? turmasHTML(turmas, ctx) : horariosHTML(a.horarios)}
        <div class="precos">
          ${precoBox('Mensal', a.preco_mensal, 1)}
          ${precoBox('Semestral*', a.preco_semestral, 6)}
          ${precoBox('Anual*', a.preco_anual, 12)}
          ${precoBox('Diária', a.preco_diaria, 1, 'diaria')}
        </div>
        <p class="precos-obs">* Para contratar os planos semestral ou anual, compareça pessoalmente à recepção.</p>
        ${inscricaoAluno(a, turmas, ctx.alunos)}
        ${isGestor ? `
          ${turmas.length ? '' : `
          <div class="vagas-gestor no-print">
            <span class="badge ${cheia ? 'erro' : 'ok'}">${o.ativa}/${a.vagas} vagas</span>
            <span>${cheia ? 'Aula cheia · ' : ''}${o.espera} na lista de espera</span>
          </div>`}
          <div class="aula-acoes no-print">
            <button class="btn sec pequeno" data-turma="${a.id}" type="button">Ver alunos</button>
            <button class="btn sec pequeno" data-turmas="${a.id}" type="button">Turmas${turmas.length ? ` (${turmas.length})` : ''}</button>
            <button class="btn pequeno" data-editar="${a.id}" type="button">Editar</button>
          </div>` : ''}
      </div>
    </article>`;
}

// ------------------------------------------------------------------ alunos da aula (por turma)
async function verAlunos(aula, turmas) {
  const m = abrirModal({ titulo: `Alunos — ${aula.nome}`, largura: 560, corpo: carregando() });
  try {
    const mats = ok(await sb.from('matriculas')
      .select('id,status,plano,turma_id,created_at,alunos(id,nome,ativo,participante_proprio,participante_nome,foto)')
      .eq('aula_id', aula.id).in('status', ['ativa', 'espera']).order('created_at'));
    const lista = (arr, fila) => arr.length
      ? `<ol style="margin:0;padding-left:22px">${arr.map((x) => `
          <li style="margin:6px 0"><span class="com-avatar">${avatarHTML(x.alunos.foto, nomeParticipante(x.alunos), 34)}<span><a href="#/alunos/${x.alunos.id}" data-ir>${esc(nomeParticipante(x.alunos))}</a>${nomeParticipante(x.alunos) !== x.alunos.nome ? ` <small class="sub">(resp.: ${esc(x.alunos.nome)})</small>` : ''}
          <span class="badge">${planoLabel(x.plano)}</span>${x.alunos.ativo ? '' : ' <span class="badge cinza">Desativado</span>'}</span></span></li>`).join('')}</ol>`
      : vazio(fila ? 'Ninguém na lista de espera.' : 'Nenhum aluno inscrito.');
    const grupo = (titulo, vagas, doGrupo) => {
      const ativos = doGrupo.filter((x) => x.status === 'ativa');
      const espera = doGrupo.filter((x) => x.status === 'espera');
      return `
        <section class="grupo-turma">
          <h3>${esc(titulo)} <span class="badge ${ativos.length >= vagas ? 'erro' : 'ok'}">${ativos.length}/${vagas} vagas</span></h3>
          <h4>Inscritos</h4>${lista(ativos, false)}
          <h4>Lista de espera (por ordem de reserva)</h4>${lista(espera, true)}
        </section>`;
    };
    const semTurma = mats.filter((x) => !x.turma_id);
    m.el.innerHTML = turmas.length
      ? turmas.map((t) => grupo(t.nome, t.vagas, mats.filter((x) => x.turma_id === t.id))).join('')
        + (semTurma.length ? grupo('Sem turma definida', aula.vagas, semTurma)
          + '<p class="sub">Abra a ficha desses alunos e use “Trocar turma” para colocá-los numa turma.</p>' : '')
      : grupo(aula.nome, aula.vagas, mats);
    ativarFotos(m.el);
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-ir]')) m.fechar(); });
  } catch (e) {
    m.el.innerHTML = erroBox(e);
  }
}

// ------------------------------------------------------------------ turmas (gestor)
function gerenciarTurmas(aula, aoMudar) {
  let mudou = false;
  const m = abrirModal({ titulo: `Turmas — ${aula.nome}`, largura: 580, corpo: carregando(), aoFechar: () => { if (mudou) aoMudar(); } });

  async function listar() {
    m.el.innerHTML = carregando();
    let turmas, oc = {};
    try {
      turmas = ok(await sb.from('turmas').select('*').eq('aula_id', aula.id).order('ordem').order('nome'));
      const mats = ok(await sb.from('matriculas').select('turma_id,status').eq('aula_id', aula.id).in('status', ['ativa', 'espera']));
      for (const x of mats) if (x.turma_id) (oc[x.turma_id] ??= { ativa: 0, espera: 0 })[x.status]++;
    } catch (e) { m.el.innerHTML = erroBox(e); return; }
    m.el.innerHTML = `
      <p class="sub" style="margin-top:0">Cada turma tem seus horários, características e vagas. Os alunos veem as turmas no cartão da aula
        e escolhem uma ao pedir inscrição. Turmas cheias aparecem em cinza.</p>
      ${turmas.length ? `<ul class="lista-turmas">${turmas.map((t) => {
        const o = oc[t.id] || { ativa: 0, espera: 0 };
        return `<li>
          <div><strong>${esc(t.nome)}</strong> ${t.ativa ? '' : '<span class="badge cinza">Oculta</span>'}
            <span class="badge ${o.ativa >= t.vagas ? 'erro' : 'ok'}">${o.ativa}/${t.vagas} vagas</span>${o.espera ? ` <span class="badge alerta">${o.espera} na fila</span>` : ''}
            ${t.horarios ? `<small>${esc(t.horarios).replace(/\n/g, ' · ')}</small>` : ''}
            ${t.descricao ? `<small>${esc(t.descricao)}</small>` : ''}</div>
          <button class="btn sec pequeno" type="button" data-editar-turma="${t.id}">Editar</button>
        </li>`;
      }).join('')}</ul>`
        : '<div class="aviso info">Esta aula ainda não tem turmas: todos os alunos ficam juntos, com as vagas e os horários definidos em “Editar”.</div>'}
      <div class="acoes">
        <button class="btn sec" type="button" data-fechar-modal>Fechar</button>
        <button class="btn" type="button" data-nova-turma>＋ Nova turma</button>
      </div>`;
    m.el.querySelector('[data-fechar-modal]').onclick = () => m.fechar();
    m.el.querySelector('[data-nova-turma]').onclick = () => formulario(null, turmas.length);
    m.el.querySelectorAll('[data-editar-turma]').forEach((b) => {
      b.onclick = () => formulario(turmas.find((t) => t.id === b.dataset.editarTurma));
    });
  }

  function formulario(turma, qtd = 0) {
    const novo = !turma;
    const t = turma || { nome: '', horarios: '', descricao: '', vagas: 10, ativa: true, ordem: qtd + 1 };
    m.el.innerHTML = `
      <form id="f-turma" novalidate>
        <h3 style="margin:0 0 12px">${novo ? 'Nova turma' : `Editar turma — ${esc(t.nome)}`}</h3>
        <label class="campo"><span>Nome da turma *</span><input type="text" name="nome" required maxlength="60" value="${esc(t.nome)}" placeholder="Ex.: Turma A — Manhã"></label>
        <label class="campo"><span>Horários</span><textarea name="horarios" maxlength="400" rows="2" placeholder="Seg, Qua e Sex · 07h às 08h">${esc(t.horarios)}</textarea><small>Um horário por linha.</small></label>
        <label class="campo"><span>Características</span><textarea name="descricao" maxlength="300" rows="2" placeholder="Ex.: iniciantes · 6 a 10 anos · prof. Ana">${esc(t.descricao)}</textarea><small>Nível, faixa etária, professor… Aparece para os alunos.</small></label>
        <div class="grade2">
          <label class="campo"><span>Vagas *</span><input type="number" name="vagas" min="0" step="1" required value="${t.vagas}"><small>Só a equipe vê este número.</small></label>
          <label class="campo"><span>Ordem</span><input type="number" name="ordem" step="1" value="${t.ordem}"></label>
        </div>
        <label class="check"><input type="checkbox" name="ativa" ${t.ativa ? 'checked' : ''}> Mostrar esta turma aos alunos</label>
        <div id="t-erro"></div>
        <div class="acoes">
          ${novo ? '' : '<button type="button" class="btn perigo sec esq" data-excluir>Excluir</button>'}
          <button type="button" class="btn sec" data-voltar>Voltar</button>
          <button type="submit" class="btn">Salvar turma</button>
        </div>
      </form>`;
    const form = m.el.querySelector('#f-turma');
    const erro = (x) => { m.el.querySelector('#t-erro').innerHTML = x ? `<div class="aviso erro">${esc(x)}</div>` : ''; };
    m.el.querySelector('[data-voltar]').onclick = listar;
    m.el.querySelector('[data-excluir]')?.addEventListener('click', async (e) => {
      if (!(await confirmar(`Excluir a turma “${t.nome}”?`, { titulo: 'Excluir turma', confirmarTexto: 'Excluir', perigo: true }))) return;
      await comBotao(e.currentTarget, async () => {
        try {
          ok(await sb.from('turmas').delete().eq('id', t.id));
          mudou = true;
          toast('Turma excluída.');
          listar();
        } catch (err) { erro(err.message); }
      });
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nome = form.nome.value.trim();
      if (!nome) return erro('Informe o nome da turma.');
      const vagas = Number(form.vagas.value);
      if (!Number.isInteger(vagas) || vagas < 0) return erro('Vagas deve ser um número inteiro (0 ou mais).');
      const limpa = (v) => v.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') || null;
      const dados = {
        aula_id: aula.id, nome, vagas, ordem: Number(form.ordem.value) || 0, ativa: form.ativa.checked,
        horarios: limpa(form.horarios.value), descricao: form.descricao.value.trim() || null,
      };
      await comBotao(form.querySelector('[type=submit]'), async () => {
        try {
          ok(novo ? await sb.from('turmas').insert(dados) : await sb.from('turmas').update(dados).eq('id', t.id));
          mudou = true;
          toast(novo ? 'Turma criada.' : 'Turma atualizada.');
          listar();
        } catch (err) { erro(err.message); }
      });
    });
  }

  listar();
}

// ------------------------------------------------------------------ editar / criar aula
function editarAula(aula, aoSalvar) {
  const novo = !aula;
  const a = aula || { nome: '', descricao: '', horarios: '', foto_url: null, preco_mensal: null, preco_semestral: null, preco_anual: null, preco_diaria: null, vagas: 20, ativa: true, ordem: 0 };
  const m = abrirModal({
    titulo: novo ? 'Nova aula' : `Editar — ${a.nome}`,
    largura: 580,
    corpo: `
      <form id="f-aula" novalidate>
        <label class="campo"><span>Nome da aula *</span><input type="text" name="nome" required maxlength="80" value="${esc(a.nome)}"></label>
        <label class="campo"><span>Descrição</span><textarea name="descricao" maxlength="400">${esc(a.descricao)}</textarea></label>
        <label class="campo"><span>Horários</span><textarea name="horarios" maxlength="500" rows="3" placeholder="Seg, Qua e Sex · 07h às 08h&#10;Ter e Qui · 18h às 19h">${esc(a.horarios)}</textarea><small>Um horário por linha. Aparece para visitantes e alunos. Se a aula tiver turmas, aparecem os horários de cada turma.</small></label>
        <div class="grade2">
          <label class="campo"><span>Mensal (R$)</span><input type="number" name="preco_mensal" min="0" step="0.01" inputmode="decimal" value="${a.preco_mensal ?? ''}"></label>
          <label class="campo"><span>Semestral (R$)</span><input type="number" name="preco_semestral" min="0" step="0.01" inputmode="decimal" value="${a.preco_semestral ?? ''}"></label>
          <label class="campo"><span>Anual (R$)</span><input type="number" name="preco_anual" min="0" step="0.01" inputmode="decimal" value="${a.preco_anual ?? ''}"></label>
          <label class="campo"><span>Diária (R$)</span><input type="number" name="preco_diaria" min="0" step="0.01" inputmode="decimal" value="${a.preco_diaria ?? ''}"></label>
        </div>
        <p class="sub" style="margin:-6px 0 14px">Semestral e anual são o valor <strong>total</strong> do plano. Deixe em branco para exibir “Consulte”.</p>
        <div class="grade2">
          <label class="campo"><span>Vagas *</span><input type="number" name="vagas" min="0" step="1" required value="${a.vagas}"><small>Só gestores veem. Se a aula tiver turmas, valem as vagas de cada turma.</small></label>
          <label class="campo"><span>Ordem na tela</span><input type="number" name="ordem" step="1" value="${a.ordem}"><small>Menor número aparece primeiro.</small></label>
        </div>
        <div class="campo">
          <span>Foto da aula</span>
          <div id="previa-wrap">${a.foto_url ? `<img class="foto-previa" id="previa" src="${esc(a.foto_url)}" alt="">` : '<img class="foto-previa" id="previa" alt="" hidden>'}</div>
          <input type="file" name="foto" accept="image/jpeg,image/png,image/webp">
          <small>JPG, PNG ou WebP, até 5 MB.</small>
          ${a.foto_url ? '<label class="check" style="margin:8px 0 0;font-weight:500"><input type="checkbox" name="remover_foto"> Remover foto atual</label>' : ''}
        </div>
        <label class="check"><input type="checkbox" name="ativa" ${a.ativa ? 'checked' : ''}> Exibir esta aula na tela pública</label>
        <div id="f-erro"></div>
        <div class="acoes">
          ${novo ? '' : '<button type="button" class="btn perigo sec esq" data-excluir>Excluir</button>'}
          <button type="button" class="btn sec" data-cancelar>Cancelar</button>
          <button type="submit" class="btn">Salvar</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-aula');
  const erro = (t) => { m.el.querySelector('#f-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();

  form.foto.addEventListener('change', () => {
    const f = form.foto.files[0];
    const previa = m.el.querySelector('#previa');
    if (!f) return;
    if (f.size > FOTO_MAX) { erro('A foto passa de 5 MB. Escolha uma menor.'); form.foto.value = ''; return; }
    erro('');
    previa.src = URL.createObjectURL(f);
    previa.hidden = false;
  });

  m.el.querySelector('[data-excluir]')?.addEventListener('click', async (e) => {
    const sim = await confirmar(`Excluir a aula “${a.nome}”? Se houver alunos matriculados, a exclusão não será permitida (use “Exibir esta aula” desmarcado para ocultá-la).`, { titulo: 'Excluir aula', confirmarTexto: 'Excluir', perigo: true });
    if (!sim) return;
    await comBotao(e.currentTarget, async () => {
      try {
        ok(await sb.from('aulas').delete().eq('id', a.id));
        toast('Aula excluída.');
        m.fechar();
        aoSalvar();
      } catch (err) {
        erro(err.code === '23503' ? 'Esta aula tem alunos (ou histórico) ligados a ela. Desmarque “Exibir esta aula” para ocultá-la.' : err.message);
      }
    });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const num = (n) => (form[n].value === '' ? null : Number(form[n].value));
    const nome = form.nome.value.trim();
    if (!nome) return erro('Informe o nome da aula.');
    const vagas = Number(form.vagas.value);
    if (!Number.isInteger(vagas) || vagas < 0) return erro('Vagas deve ser um número inteiro (0 ou mais).');
    for (const n of ['preco_mensal', 'preco_semestral', 'preco_anual', 'preco_diaria']) {
      if (num(n) !== null && num(n) < 0) return erro('Os preços não podem ser negativos.');
    }
    erro('');
    await comBotao(btn, async () => {
      let foto_url = a.foto_url;
      if (form.remover_foto?.checked) foto_url = null;
      const arq = form.foto.files[0];
      if (arq) {
        const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[arq.type];
        if (!ext) throw new Error('Formato de foto não aceito. Use JPG, PNG ou WebP.');
        const caminho = `${crypto.randomUUID()}.${ext}`;
        ok(await sb.storage.from('aulas').upload(caminho, arq, { contentType: arq.type, cacheControl: '31536000' }));
        foto_url = sb.storage.from('aulas').getPublicUrl(caminho).data.publicUrl;
      }
      const dados = {
        nome,
        descricao: form.descricao.value.trim() || null,
        horarios: form.horarios.value.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') || null,
        preco_mensal: num('preco_mensal'),
        preco_semestral: num('preco_semestral'),
        preco_anual: num('preco_anual'),
        preco_diaria: num('preco_diaria'),
        vagas,
        ordem: Number(form.ordem.value) || 0,
        ativa: form.ativa.checked,
        foto_url,
      };
      ok(novo ? await sb.from('aulas').insert(dados) : await sb.from('aulas').update(dados).eq('id', a.id));
      toast(novo ? 'Aula criada.' : 'Aula atualizada.');
      m.fechar();
      aoSalvar();
    });
  });
}
