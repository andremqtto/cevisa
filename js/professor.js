// Painel do professor: alunos das aulas (modalidades) dele, por turma, + cadastro de alunos e QR Code.
// O professor não vê valores, pagamentos nem as fichas completas.
import { sb, ok } from './supabase.js';
import { avatarHTML, ativarFotos } from './fotos.js';
import { esc, fmtDate, carregando, vazio, erroBox, horariosHTML, linkWhatsAppPara, ICONE_WHATSAPP, abrirModal, toast, comBotao, hojeISO, PLANOS } from './ui.js';

const idade = (nasc) => {
  if (!nasc) return null;
  const [y, m, d] = nasc.split('-').map(Number);
  const h = new Date();
  let anos = h.getFullYear() - y;
  if (h.getMonth() + 1 < m || (h.getMonth() + 1 === m && h.getDate() < d)) anos--;
  return anos;
};

export async function renderProfessor(el, { navegar }) {
  el.innerHTML = carregando('Carregando seus alunos…');
  let dados;
  try {
    dados = ok(await sb.rpc('professor_painel'));
  } catch (e) { el.innerHTML = erroBox(e); return; }
  const recarregar = () => renderProfessor(el, { navegar });
  const { aulas, cadastrados } = dados;
  const total = aulas.reduce((s, a) => s + a.alunos.filter((x) => x.status === 'ativa').length, 0);

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Meus alunos</h1><p class="sub">${aulas.length ? `${total} aluno(s) inscrito(s) em ${aulas.length} modalidade(s)` : 'Alunos das suas modalidades'}</p></div>
      <div class="acoes-linha no-print">
        <button class="btn sec" type="button" id="qr">QR Code do app</button>
        <button class="btn" type="button" id="novo">＋ Novo aluno</button>
      </div>
    </div>
    ${aulas.length ? '<input type="text" id="busca" class="busca-prof no-print" placeholder="Buscar aluno…" aria-label="Buscar aluno">' : ''}
    <div id="prof-aulas">${aulas.length ? aulas.map(cartaoAula).join('')
      : '<div class="card">' + vazio('Nenhuma modalidade foi atribuída a você ainda. Peça ao gestor para escolher suas aulas na aba Equipe.') + '</div>'}</div>

    ${cadastrados.length ? `
    <section class="card">
      <h2>Alunos que você cadastrou</h2>
      <ul class="lista-equipe">${cadastrados.map((c) => `
        <li><div><strong>${esc(c.cadastro_completo ? c.nome : c.email)}</strong>
          <small>${c.cadastro_completo ? esc(c.email || '') : 'aguardando o 1º acesso do aluno'} · ${fmtDate(c.created_at.slice(0, 10))}</small></div></li>`).join('')}</ul>
    </section>` : ''}`;

  ativarFotos(el);
  el.querySelector('#qr').onclick = async () => (await import('./alunos.js')).abrirQrCode();
  el.querySelector('#novo').onclick = async () => (await import('./alunos.js')).novoAluno(navegar, {
    professor: true, aoCriar: recarregar,
    aoManual: aulas.length ? () => inscreverManual(aulas, recarregar) : null,
  });
  el.querySelector('#busca')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('.prof-aluno').forEach((li) => { li.hidden = !!q && !li.dataset.nome.includes(q); });
  });
}

function cartaoAula(aula) {
  const grupos = aula.turmas.length
    ? [...aula.turmas.map((t) => ({ titulo: t.nome, horarios: t.horarios, vagas: t.vagas, alunos: aula.alunos.filter((x) => x.turma_id === t.id) })),
       ...(aula.alunos.some((x) => !x.turma_id || !aula.turmas.some((t) => t.id === x.turma_id))
         ? [{ titulo: 'Sem turma definida', alunos: aula.alunos.filter((x) => !x.turma_id || !aula.turmas.some((t) => t.id === x.turma_id)) }] : [])]
    : [{ titulo: null, horarios: aula.horarios, vagas: aula.vagas, alunos: aula.alunos }];
  return `
    <section class="card prof-aula">
      <h2>${esc(aula.nome)}</h2>
      ${grupos.map((g) => {
        const ativos = g.alunos.filter((x) => x.status === 'ativa');
        const espera = g.alunos.filter((x) => x.status === 'espera');
        return `
        <div class="grupo-turma">
          ${g.titulo ? `<h3>${esc(g.titulo)} ${g.vagas !== undefined ? `<span class="badge ${ativos.length >= g.vagas ? 'erro' : 'ok'}">${ativos.length}/${g.vagas}</span>` : ''}</h3>` : `<p class="sub" style="margin:0 0 6px">${ativos.length}/${g.vagas} vagas ocupadas</p>`}
          ${horariosHTML(g.horarios)}
          ${ativos.length ? `<ul class="prof-lista">${ativos.map(linhaAluno).join('')}</ul>` : vazio('Nenhum aluno inscrito.')}
          ${espera.length ? `<h4>Lista de espera</h4><ol class="prof-lista">${espera.map(linhaAluno).join('')}</ol>` : ''}
        </div>`;
      }).join('')}
    </section>`;
}

// ------------------------------------------------------------------ cadastro manual + inscrição
/** Aluno sem celular/e-mail: o professor cadastra os dados básicos e inscreve numa aula dele (reserva de vaga). */
function inscreverManual(aulas, aoConcluir) {
  const m = abrirModal({
    titulo: 'Cadastrar e inscrever',
    largura: 540,
    corpo: `
      <form id="f-manual" novalidate>
        <p class="sub" style="margin-top:0">O aluno fica <strong>sem acesso ao app</strong>. A vaga fica reservada e a recepção confirma a inscrição quando registrar o pagamento.</p>
        <label class="campo"><span>Nome completo de quem vai fazer as aulas *</span><input type="text" name="nome" maxlength="120" required></label>
        <div class="grade2">
          <label class="campo"><span>Telefone / WhatsApp *</span><input type="tel" name="telefone" maxlength="20" inputmode="tel" required><small>Do aluno ou do responsável.</small></label>
          <label class="campo"><span>Data de nascimento *</span><input type="date" name="nasc" max="${hojeISO()}" required></label>
          <label class="campo"><span>CPF</span><input type="text" name="cpf" maxlength="14" inputmode="numeric"></label>
          <label class="campo"><span>E-mail</span><input type="email" name="email" maxlength="120" inputmode="email" autocapitalize="none"></label>
        </div>
        <label class="campo"><span>Aula *</span>
          <select name="aula">${aulas.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></label>
        <div id="pm-turma"></div>
        <label class="campo"><span>Plano *</span>
          <select name="plano">${Object.entries(PLANOS).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
        <label class="campo"><span>Observações</span><textarea name="obs" maxlength="800" rows="2" placeholder="Ex.: responsável é a mãe, Maria"></textarea></label>
        <div id="pm-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Cadastrar e inscrever</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-manual');
  const erro = (t) => { m.el.querySelector('#pm-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  const turmasHTML = () => {
    const a = aulas.find((x) => x.id === form.aula.value);
    m.el.querySelector('#pm-turma').innerHTML = a?.turmas?.length ? `
      <label class="campo"><span>Turma *</span>
        <select name="turma">${a.turmas.map((t) => {
          const ocup = a.alunos.filter((x) => x.turma_id === t.id && x.status === 'ativa').length;
          return `<option value="${t.id}">${esc(t.nome)} — ${ocup >= t.vagas ? 'cheia (lista de espera)' : `${t.vagas - ocup} vaga(s)`}</option>`;
        }).join('')}</select></label>` : '';
  };
  form.aula.addEventListener('change', turmasHTML);
  turmasHTML();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if (nome.split(/\s+/).length < 2) return erro('Informe o nome completo (nome e sobrenome).');
    if (form.telefone.value.replace(/\D/g, '').length < 10) return erro('Informe o telefone com DDD.');
    if (!form.nasc.value) return erro('Informe a data de nascimento.');
    const email = form.email.value.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return erro('E-mail inválido.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const r = ok(await sb.rpc('professor_cadastrar_aluno', {
          p_nome: nome, p_telefone: form.telefone.value.trim(), p_nascimento: form.nasc.value,
          p_cpf: form.cpf.value.trim() || null, p_email: email || null,
          p_aula: form.aula.value, p_turma: form.turma?.value || null, p_plano: form.plano.value,
          p_obs: form.obs.value.trim() || null,
        }));
        m.fechar();
        toast(r.status === 'espera'
          ? `${nome} cadastrado(a) e na lista de espera (posição ${r.posicao_espera}).`
          : `${nome} cadastrado(a) com vaga reservada. A recepção confirma ao registrar o pagamento.`);
        aoConcluir();
      } catch (err) { erro(err.message); }
    });
  });
}

function linhaAluno(x) {
  const anos = idade(x.nascimento);
  // a mensagem vai para o telefone do responsável
  const zap = linkWhatsAppPara(x.telefone, `Olá, ${(x.responsavel || x.nome).split(' ')[0]}!`);
  return `
    <li class="prof-aluno" data-nome="${esc(x.nome.toLowerCase())}">
      ${avatarHTML(x.foto, x.nome, 44)}
      <div><strong>${esc(x.nome)}</strong>
        <small>${[anos !== null ? `${anos} anos` : '', x.responsavel ? `resp.: ${esc(x.responsavel)}` : '', x.telefone ? esc(x.telefone) : ''].filter(Boolean).join(' · ') || '—'}</small></div>
      ${zap ? `<a class="icone-btn prof-zap" href="${esc(zap)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(x.nome)}">${ICONE_WHATSAPP}</a>` : ''}
    </li>`;
}
