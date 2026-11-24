// Cobranças (pagamentos pendentes/pagos) e o diálogo de registrar pagamento.
import { sb, ok } from './supabase.js';
import {
  esc, money, fmtDate, fmtMes, planoLabel, hojeISO, diasEntre, abrirModal, toast, confirmar,
  comBotao, carregando, vazio, erroBox, linkCobrancaWhatsApp, ICONE_WHATSAPP,
  primeiroDiaMes, precoVinculo, vinculoPreco, moneyOuIsento, nomeParticipante,
} from './ui.js';
import { reduzirImagem } from './fotos.js';

const FORMAS = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto', 'Transferência'];

/**
 * Abre o diálogo para registrar o pagamento de uma cobrança.
 * pag: { id, aluno_id, aluno_nome, plano, valor, vencimento }
 */
export function registrarPagamento(pag, aoConcluir) {
  const m = abrirModal({
    titulo: 'Registrar pagamento',
    largura: 460,
    corpo: `
      <p style="margin:0 0 14px"><strong>${esc(pag.aluno_nome)}</strong><br>
        Plano ${esc(planoLabel(pag.plano))} · <strong>${money(pag.valor)}</strong> · vencimento ${fmtDate(pag.vencimento)}</p>
      <form id="f-pag" novalidate>
        <div class="grade2">
          <label class="campo"><span>Forma de pagamento</span>
            <select name="forma">${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select></label>
          <label class="campo"><span>Data do pagamento</span>
            <input type="date" name="data" required value="${hojeISO()}" max="${hojeISO()}"></label>
        </div>
        <div id="pag-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Confirmar pagamento</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-pag');
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.data.value) return;
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.rpc('registrar_pagamento', { p_pagamento: pag.id, p_forma: form.forma.value, p_data: form.data.value }));
      } catch (err) {
        m.el.querySelector('#pag-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
        return;
      }
      m.fechar();
      toast('Pagamento registrado.');
      // Se o aluno estiver desativado, oferece reativar (a decisão é sempre do gestor).
      try {
        const al = ok(await sb.from('alunos').select('ativo').eq('id', pag.aluno_id).single());
        if (!al.ativo) {
          const sim = await confirmar(`${pag.aluno_nome} está desativado. Deseja ativar o aluno agora?`, { titulo: 'Ativar aluno?', confirmarTexto: 'Ativar' });
          if (sim) {
            ok(await sb.from('alunos').update({ ativo: true }).eq('id', pag.aluno_id));
            toast('Aluno ativado.');
          }
        }
      } catch (err) {
        toast(err.message, 'erro');
      }
      aoConcluir?.();
    });
  });
}

export const dadosParaPagamento = (p) => ({
  id: p.id, aluno_id: p.aluno_id, aluno_nome: p.alunos?.nome ?? p.aluno, plano: p.plano, valor: p.valor, vencimento: p.vencimento,
});

// ------------------------------------------------------------------ lançar diária
/** Lançamento manual de uma diária (pagamento avulso): valor, forma, data e, se quiser, a modalidade. */
export async function lancarDiaria(aoConcluir) {
  const m = abrirModal({ titulo: 'Lançar diária', largura: 460, corpo: carregando() });
  let aulas = [];
  try {
    aulas = ok(await sb.from('aulas').select('id,nome,preco_diaria').order('ordem').order('nome'));
  } catch (e) { m.el.innerHTML = erroBox(e); return; }
  m.el.innerHTML = `
    <form id="f-diaria" novalidate>
      <div class="grade2">
        <label class="campo"><span>Valor (R$) *</span>
          <input type="number" name="valor" min="0" step="0.01" inputmode="decimal" required></label>
        <label class="campo"><span>Data do pagamento *</span>
          <input type="date" name="data" required value="${hojeISO()}" max="${hojeISO()}"></label>
      </div>
      <label class="campo"><span>Método de pagamento *</span>
        <select name="forma">${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select></label>
      <label class="campo"><span>Modalidade</span>
        <select name="aula"><option value="">Sem modalidade</option>${aulas.map((a) => `<option value="${a.id}">${esc(a.nome)}${a.preco_diaria !== null && a.preco_diaria !== undefined ? ` — ${money(a.preco_diaria)}` : ''}</option>`).join('')}</select>
        <small>Opcional. Escolher a modalidade separa a diária no relatório por modalidade.</small></label>
      <label class="campo"><span>Descrição</span><input type="text" name="descricao" maxlength="120" placeholder="Ex.: visitante Maria Souza"></label>
      <div id="d-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-cancelar>Cancelar</button>
        <button class="btn" type="submit">Lançar diária</button>
      </div>
    </form>`;
  const form = m.el.querySelector('#f-diaria');
  const erro = (t) => { m.el.querySelector('#d-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  // ao escolher a modalidade, sugere o preço da diária dela
  form.aula.addEventListener('change', () => {
    const a = aulas.find((x) => x.id === form.aula.value);
    if (a && a.preco_diaria !== null && a.preco_diaria !== undefined && !form.valor.value) form.valor.value = a.preco_diaria;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = Number(form.valor.value);
    if (form.valor.value === '' || !(valor > 0)) return erro('Informe o valor da diária.');
    if (!form.data.value) return erro('Informe a data do pagamento.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.from('diarias').insert({
          valor, forma: form.forma.value, data: form.data.value,
          aula_id: form.aula.value || null, descricao: form.descricao.value.trim() || null,
        }));
        m.fechar();
        toast(`Diária de ${money(valor)} lançada.`);
        aoConcluir?.();
      } catch (err) { erro(err.message); }
    });
  });
}

// ------------------------------------------------------------------ lançar reembolso
/** Reembolso = a empresa devolve dinheiro (saída). Aluno opcional; abate do total recebido nos relatórios. */
export async function lancarReembolso(aoConcluir) {
  const m = abrirModal({ titulo: 'Lançar reembolso', largura: 480, corpo: carregando() });
  let alunos = [];
  try {
    alunos = ok(await sb.from('alunos').select('id,nome,participante_proprio,participante_nome').order('nome'));
  } catch (e) { m.el.innerHTML = erroBox(e); return; }
  const semAcento = (x) => (x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let aluno = null;
  m.el.innerHTML = `
    <form id="f-reemb" novalidate>
      <p class="sub" style="margin:0 0 12px">Valor que a empresa <strong>devolveu</strong>. Ele entra como saída e é descontado do total recebido nos relatórios.</p>
      <label class="campo"><span>Aluno (opcional)</span>
        <input type="search" name="busca" placeholder="Digite o nome do aluno…" autocomplete="off"></label>
      <div id="re-resultados" class="lm-resultados"></div>
      <div id="re-escolhido"></div>
      <div class="grade2">
        <label class="campo"><span>Valor do reembolso (R$) *</span>
          <input type="number" name="valor" min="0.01" step="0.01" inputmode="decimal" required></label>
        <label class="campo"><span>Data *</span>
          <input type="date" name="data" required value="${hojeISO()}" max="${hojeISO()}"></label>
      </div>
      <label class="campo"><span>Observações</span>
        <textarea name="obs" maxlength="500" rows="3" placeholder="Ex.: desistência antes do início das aulas, devolvido por Pix"></textarea></label>
      <div id="re-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-cancelar>Cancelar</button>
        <button class="btn perigo" type="submit">Lançar reembolso</button>
      </div>
    </form>`;
  const form = m.el.querySelector('#f-reemb');
  const resultados = m.el.querySelector('#re-resultados');
  const escolhido = m.el.querySelector('#re-escolhido');
  const erro = (t) => { m.el.querySelector('#re-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  const mostrarEscolhido = () => {
    escolhido.innerHTML = aluno ? `<div class="aviso info" style="margin-top:0">Aluno: <strong>${esc(nomeParticipante(aluno))}</strong>${nomeParticipante(aluno) !== aluno.nome ? ` <small>(resp.: ${esc(aluno.nome)})</small>` : ''}
      <button class="btn sec pequeno" type="button" data-tirar style="margin-left:8px">Remover</button></div>` : '';
    escolhido.querySelector('[data-tirar]')?.addEventListener('click', () => { aluno = null; mostrarEscolhido(); });
  };
  form.busca.addEventListener('input', () => {
    const q = semAcento(form.busca.value.trim());
    if (!q) { resultados.innerHTML = ''; return; }
    const achados = alunos.filter((a) => semAcento(`${a.nome} ${a.participante_nome || ''}`).includes(q)).slice(0, 8);
    resultados.innerHTML = achados.length
      ? achados.map((a) => `<button type="button" class="lm-item" data-aluno="${a.id}"><strong>${esc(nomeParticipante(a))}</strong>${nomeParticipante(a) !== a.nome ? ` <small>(resp.: ${esc(a.nome)})</small>` : ''}</button>`).join('')
      : '<p class="sub" style="margin:4px 0 10px">Nenhum aluno encontrado.</p>';
  });
  resultados.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aluno]');
    if (!b) return;
    aluno = alunos.find((a) => a.id === b.dataset.aluno);
    form.busca.value = '';
    resultados.innerHTML = '';
    mostrarEscolhido();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valor = Number(form.valor.value);
    if (form.valor.value === '' || !(valor > 0)) return erro('Informe o valor do reembolso.');
    if (!form.data.value) return erro('Informe a data do reembolso.');
    if (form.data.value > hojeISO()) return erro('A data do reembolso não pode ser no futuro.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.from('reembolsos').insert({
          valor, data: form.data.value, aluno_id: aluno?.id || null, observacao: form.obs.value.trim() || null,
        }));
        m.fechar();
        toast(`Reembolso de ${money(valor)} lançado.`);
        aoConcluir?.();
      } catch (err) { erro(err.message); }
    });
  });
}

// ------------------------------------------------------------------ confirmar pagamento informado pelo aluno
const PRECO_PLANO = { mensal: 'preco_mensal', semestral: 'preco_semestral', anual: 'preco_anual' };

/**
 * Aberto pela notificação "Pagamento informado" / "Comprovante enviado": lista a próxima mensalidade
 * de cada aula ativa do aluno (as que vencem em até 30 dias já vêm marcadas) e dá baixa de uma vez.
 */
export async function confirmarPagamentoInformado({ alunoId, mensagem = '', navegar, aoConcluir } = {}) {
  const m = abrirModal({ titulo: 'Confirmar pagamento', largura: 520, corpo: carregando() });
  let aluno, mats;
  try {
    aluno = ok(await sb.from('alunos').select('id,nome,participante_proprio,participante_nome,vinculo').eq('id', alunoId).single());
    // família: as aulas dos dependentes também são cobradas do responsável
    const rf = await sb.rpc('familia_aluno', { p_aluno: alunoId });
    const ids = !rf.error && rf.data?.length ? rf.data.map((x) => x.id) : [alunoId];
    mats = ok(await sb.from('matriculas')
      .select('id,plano,data_fim,valor_personalizado,aluno_id,alunos(id,nome,participante_proprio,participante_nome,vinculo),aulas(nome,preco_mensal,preco_semestral,preco_anual),turmas(nome),pagamentos(id,valor,vencimento,status)')
      .in('aluno_id', ids).eq('status', 'ativa'));
  } catch (e) { m.el.innerHTML = erroBox(e); return; }

  const hoje = hojeISO();
  const itens = mats.map((x) => {
    const pend = (x.pagamentos || []).filter((p) => p.status === 'pendente').sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    const valor = pend ? Number(pend.valor)
      : x.valor_personalizado !== null ? Number(x.valor_personalizado)
      : precoVinculo(x.aulas?.[PRECO_PLANO[x.plano]], x.plano, vinculoPreco(x.alunos || aluno));
    const venc = pend ? pend.vencimento : x.data_fim;
    return { id: x.id, quem: nomeParticipante(x.alunos || aluno), aula: x.aulas?.nome, turma: x.turmas?.nome, plano: x.plano, valor, venc, gerada: !!pend };
  }).filter((i) => i.valor !== 0).sort((a, b) => a.venc.localeCompare(b.venc));
  const variasPessoas = new Set(itens.map((i) => i.quem)).size > 1;
  const formaInformada = (mensagem.match(/Forma: ([^.]+)\./) || [])[1]?.trim();
  const ficha = () => { m.fechar(); navegar?.(`#/alunos/${alunoId}`); };

  if (!itens.length) {
    m.el.innerHTML = `
      <p style="margin:0 0 12px"><strong>${esc(nomeParticipante(aluno))}</strong></p>
      <div class="aviso info">Este aluno não tem mensalidades em aberto para confirmar.</div>
      <div class="acoes"><button class="btn sec" type="button" data-ficha>Abrir ficha do aluno</button><button class="btn" type="button" data-ok>Fechar</button></div>`;
    m.el.querySelector('[data-ficha]').onclick = ficha;
    m.el.querySelector('[data-ok]').onclick = () => m.fechar();
    return;
  }

  m.el.innerHTML = `
    <p style="margin:0 0 4px">${variasPessoas ? `<strong>${esc(aluno.nome)}</strong> <small class="sub">responsável · ${[...new Set(itens.map((i) => i.quem))].map(esc).join(', ')}</small>`
      : `<strong>${esc(nomeParticipante(aluno))}</strong>${nomeParticipante(aluno) !== aluno.nome ? ` <small class="sub">resp.: ${esc(aluno.nome)}</small>` : ''}`}</p>
    ${mensagem ? `<p class="sub" style="margin:0 0 12px">${esc(mensagem)}</p>` : ''}
    <form id="f-confirma" novalidate>
      <fieldset class="vinculo"><legend>Mensalidades pagas</legend>${itens.map((i) => {
        const d = diasEntre(hoje, i.venc);
        return `<label class="check vinculo-opcao"><input type="checkbox" name="mat" value="${i.id}" ${d <= 30 ? 'checked' : ''}>
          <span>${variasPessoas ? `<span class="sub">${esc(i.quem)}</span><br>` : ''}<strong>${esc(i.aula)}</strong>${i.turma ? ` — ${esc(i.turma)}` : ''} · ${esc(planoLabel(i.plano))}
            <small>${i.valor === null ? 'valor a combinar' : money(i.valor)} · vencimento ${fmtDate(i.venc)}${d < 0 ? ' <span class="badge erro">atrasada</span>' : ''}</small></span></label>`;
      }).join('')}</fieldset>
      <div class="grade2">
        <label class="campo"><span>Forma de pagamento</span>
          <select name="forma">${FORMAS.map((f) => `<option ${f === formaInformada ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label class="campo"><span>Data do pagamento</span>
          <input type="date" name="data" value="${hoje}" max="${hoje}"></label>
      </div>
      <div id="cp-total"></div>
      <div id="cp-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-ficha>Abrir ficha</button>
        <button class="btn" type="submit">Confirmar pagamento</button>
      </div>
    </form>`;
  const form = m.el.querySelector('#f-confirma');
  const erro = (t) => { m.el.querySelector('#cp-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  const marcados = () => [...form.querySelectorAll('[name=mat]:checked')].map((c) => c.value);
  const total = () => {
    const sel = itens.filter((i) => marcados().includes(i.id));
    const soma = sel.reduce((t, i) => t + (i.valor || 0), 0);
    m.el.querySelector('#cp-total').innerHTML = sel.length ? `<div class="aviso info">Total: <strong>${money(soma)}</strong> (${sel.length} mensalidade${sel.length > 1 ? 's' : ''})</div>` : '';
  };
  form.addEventListener('change', total);
  total();
  m.el.querySelector('[data-ficha]').onclick = ficha;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sel = marcados();
    if (!sel.length) return erro('Marque pelo menos uma mensalidade.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const qtd = ok(await sb.rpc('confirmar_pagamento_aluno', {
          p_aluno: alunoId, p_matriculas: sel, p_forma: form.forma.value, p_data: form.data.value || hoje,
        }));
        m.fechar();
        toast(`Pagamento confirmado: ${qtd} mensalidade${qtd === 1 ? '' : 's'} de ${variasPessoas ? aluno.nome : nomeParticipante(aluno)}.`);
        aoConcluir?.();
      } catch (err) { erro(err.message); }
    });
  });
}

// ------------------------------------------------------------------ lançar mensalidade (pagar meses adiantado)
const MESES_NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/**
 * O aluno do plano mensal quer deixar pagos vários meses: escolhe o aluno, a aula (se tiver mais de uma)
 * e os meses que faltam no ano. Os meses são sempre em sequência a partir do próximo em aberto.
 */
export async function lancarMensalidade(aoConcluir) {
  const m = abrirModal({ titulo: 'Lançar mensal', largura: 520, corpo: carregando() });
  let matriculas = [];
  try {
    matriculas = ok(await sb.from('matriculas')
      .select('id,plano,data_fim,valor_personalizado,aluno_id,alunos(id,nome,ativo,participante_proprio,participante_nome,vinculo),aulas(nome,preco_mensal)')
      .eq('status', 'ativa'));
  } catch (e) { m.el.innerHTML = erroBox(e); return; }

  // um registro por aluno, com as matrículas dele
  const alunos = new Map();
  for (const mt of matriculas) {
    if (!mt.alunos) continue;
    if (!alunos.has(mt.aluno_id)) alunos.set(mt.aluno_id, { ...mt.alunos, matriculas: [] });
    alunos.get(mt.aluno_id).matriculas.push(mt);
  }
  const lista = [...alunos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const hoje = hojeISO();
  const ano = Number(hoje.slice(0, 4));
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const fimAno = `${ano}-12-01`;

  let aluno = null;
  let mat = null;

  m.el.innerHTML = `
    <form id="f-mensal" novalidate>
      <label class="campo"><span>Aluno *</span>
        <input type="search" name="busca" placeholder="Digite o nome do aluno…" autocomplete="off"></label>
      <div id="lm-resultados" class="lm-resultados"></div>
      <div id="lm-escolhido"></div>
      <div id="lm-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-cancelar>Cancelar</button>
        <button class="btn" type="submit" disabled>Confirmar</button>
      </div>
    </form>`;
  const form = m.el.querySelector('#f-mensal');
  const resultados = m.el.querySelector('#lm-resultados');
  const escolhido = m.el.querySelector('#lm-escolhido');
  const btnOk = form.querySelector('[type=submit]');
  const erro = (t) => { m.el.querySelector('#lm-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();

  const desenharResultados = () => {
    const q = semAcento(form.busca.value.trim());
    if (!q) { resultados.innerHTML = ''; return; }
    const achados = lista.filter((a) => semAcento(`${a.nome} ${a.participante_nome || ''}`).includes(q)).slice(0, 8);
    resultados.innerHTML = achados.length
      ? achados.map((a) => `<button type="button" class="lm-item" data-aluno="${a.id}">
          <strong>${esc(a.nome)}</strong>${a.participante_proprio === false && a.participante_nome ? ` <small>(${esc(a.participante_nome)})</small>` : ''}
          <small>${a.matriculas.map((x) => esc(x.aulas?.nome)).join(' · ')}</small></button>`).join('')
      : '<p class="sub" style="margin:0 0 12px">Nenhum aluno com aula ativa encontrado.</p>';
  };
  form.busca.addEventListener('input', desenharResultados);
  resultados.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aluno]');
    if (!b) return;
    aluno = alunos.get(b.dataset.aluno);
    const mensais = aluno.matriculas.filter((x) => x.plano === 'mensal');
    mat = mensais.length === 1 ? mensais[0] : null;
    form.busca.value = aluno.nome;
    resultados.innerHTML = '';
    desenharEscolhido();
  });

  function desenharEscolhido() {
    erro('');
    if (!aluno) { escolhido.innerHTML = ''; btnOk.disabled = true; return; }
    const outras = aluno.matriculas.filter((x) => x.plano !== 'mensal');
    const mensais = aluno.matriculas.filter((x) => x.plano === 'mensal');
    let html = '';
    if (!mensais.length) {
      html = `<div class="aviso alerta">${esc(aluno.nome)} não tem aula no plano mensal (${outras.map((x) => `${esc(x.aulas?.nome)}: ${esc(planoLabel(x.plano))}`).join(', ')}). Para semestral e anual, use “Registrar pagamento” na cobrança.</div>`;
    } else {
      if (mensais.length > 1) {
        html += `<fieldset class="vinculo"><legend>Aula *</legend>${mensais.map((x) => `
          <label class="check vinculo-opcao"><input type="radio" name="mat" value="${x.id}" ${mat?.id === x.id ? 'checked' : ''}>
            <span>${esc(x.aulas?.nome)}<small>Pago até ${fmtDate(x.data_fim)}</small></span></label>`).join('')}</fieldset>`;
      }
      if (mat) html += mesesHTML(mat);
    }
    escolhido.innerHTML = html;
    atualizarTotal();
  }

  function mesesHTML(x) {
    const proximo = `${x.data_fim.slice(0, 7)}-01`; // 1º mês ainda não pago
    const inicio = proximo < mesAtual ? proximo : mesAtual;
    const meses = [];
    for (let d = inicio; d <= fimAno; d = primeiroDiaMes(d, 1)) meses.push(d);
    const abertos = meses.filter((d) => d >= proximo);
    const linha = (d) => {
      const pago = d < proximo;
      const atraso = !pago && d < mesAtual;
      return `<label class="check lm-mes ${pago ? 'pago' : ''}">
        <input type="checkbox" name="mes" value="${d}" ${pago ? 'checked disabled' : ''}>
        <span>${MESES_NOMES[Number(d.slice(5, 7)) - 1]}</span>
        ${pago ? '<span class="badge ok">Pago</span>' : atraso ? '<span class="badge erro">Em atraso</span>' : ''}</label>`;
    };
    return `
      <p class="sub" style="margin:0 0 10px">${esc(x.aulas?.nome)} · plano mensal · pago até <strong>${fmtDate(x.data_fim)}</strong></p>
      ${abertos.length ? `
      <details class="lm-meses">
        <summary>Meses de ${ano} <span id="lm-qtd" class="badge">nenhum selecionado</span></summary>
        <p class="sub" style="margin:8px 0">Os meses são pagos em sequência: ao marcar um mês, os anteriores em aberto também são marcados.</p>
        <div class="lm-grade">${meses.map(linha).join('')}</div>
      </details>
      <div class="grade2" style="margin-top:14px">
        <label class="campo"><span>Forma de pagamento</span>
          <select name="forma">${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select></label>
        <label class="campo"><span>Data do pagamento</span>
          <input type="date" name="data" value="${hoje}" max="${hoje}"></label>
      </div>
      <div id="lm-total"></div>` : `<div class="aviso ok">Todos os meses de ${ano} já estão pagos.</div>`}`;
  }

  const marcados = () => [...form.querySelectorAll('input[name=mes]:not(:disabled):checked')].map((c) => c.value);

  function atualizarTotal() {
    const sel = marcados();
    btnOk.disabled = !mat || !sel.length;
    const qtd = m.el.querySelector('#lm-qtd');
    if (qtd) qtd.textContent = sel.length ? `${sel.length} selecionado${sel.length > 1 ? 's' : ''}` : 'nenhum selecionado';
    const total = m.el.querySelector('#lm-total');
    if (!total) return;
    const preco = mat.valor_personalizado !== null ? Number(mat.valor_personalizado) : precoVinculo(mat.aulas?.preco_mensal, 'mensal', vinculoPreco(aluno));
    total.innerHTML = sel.length && preco !== null
      ? `<div class="aviso info">${sel.length} × ${moneyOuIsento(preco)} = <strong>${money(preco * sel.length)}</strong></div>` : '';
  }

  escolhido.addEventListener('change', (e) => {
    if (e.target.name === 'mat') {
      mat = aluno.matriculas.find((x) => x.id === e.target.value);
      return desenharEscolhido();
    }
    if (e.target.name === 'mes') {
      // mantém a sequência: marcar inclui os anteriores; desmarcar tira os posteriores
      const caixas = [...form.querySelectorAll('input[name=mes]:not(:disabled)')];
      const i = caixas.indexOf(e.target);
      caixas.forEach((c, j) => { if (e.target.checked ? j <= i : j >= i) c.checked = e.target.checked; });
      atualizarTotal();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sel = marcados();
    if (!aluno) return erro('Escolha o aluno.');
    if (!mat) return erro('Escolha a aula.');
    if (!sel.length) return erro('Escolha pelo menos um mês.');
    erro('');
    const nomes = sel.map((d) => MESES_NOMES[Number(d.slice(5, 7)) - 1].toLowerCase());
    await comBotao(btnOk, async () => {
      try {
        const qtd = ok(await sb.rpc('lancar_mensalidades', {
          p_matricula: mat.id, p_ate: sel[sel.length - 1], p_forma: form.forma.value, p_data: form.data.value || hoje,
        }));
        m.fechar();
        toast(`${qtd} ${qtd === 1 ? 'mês pago' : 'meses pagos'} para ${aluno.nome} (${nomes.join(', ')}).`);
        aoConcluir?.();
      } catch (err) { erro(err.message); }
    });
  });
}

// ------------------------------------------------------------------ lançar semestral / anual
/**
 * Quita o próximo período (6 ou 12 meses) de um aluno do plano semestral/anual e registra
 * em quantas vezes foi dividido no cartão. No relatório, cada parcela entra no seu mês.
 */
export async function lancarPlano(plano, aoConcluir) {
  const nomePlano = planoLabel(plano).toLowerCase();
  const meses = plano === 'anual' ? 12 : 6;
  const m = abrirModal({ titulo: `Lançar ${nomePlano}`, largura: 520, corpo: carregando() });
  let matriculas = [];
  try {
    matriculas = ok(await sb.from('matriculas')
      .select(`id,plano,data_fim,valor_personalizado,aluno_id,alunos(id,nome,participante_proprio,participante_nome,vinculo),aulas(nome,preco_${plano}),pagamentos(id,valor,vencimento,status)`)
      .eq('status', 'ativa').eq('plano', plano));
  } catch (e) { m.el.innerHTML = erroBox(e); return; }

  const alunos = new Map();
  for (const mt of matriculas) {
    if (!mt.alunos) continue;
    if (!alunos.has(mt.aluno_id)) alunos.set(mt.aluno_id, { ...mt.alunos, matriculas: [] });
    alunos.get(mt.aluno_id).matriculas.push(mt);
  }
  const lista = [...alunos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const semAcento = (x) => (x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hoje = hojeISO();
  let aluno = null;
  let mat = null;

  // valor e período que serão quitados (a cobrança pendente, se houver; senão o preço do plano)
  const proximo = (x) => {
    const pend = (x.pagamentos || []).filter((p) => p.status === 'pendente').sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    const valor = pend ? Number(pend.valor)
      : x.valor_personalizado !== null ? Number(x.valor_personalizado)
      : precoVinculo(x.aulas?.[`preco_${plano}`], plano, vinculoPreco(aluno));
    const de = pend ? pend.vencimento : x.data_fim;
    // mesmo dia, N meses depois (no fim do mês, como no banco: 31/01 + 1 mês = 28/02)
    const alvo = primeiroDiaMes(de, meses);
    const [y, mm] = alvo.split("-").map(Number);
    const ultimo = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const dia = String(Math.min(Number(de.slice(8, 10)), ultimo)).padStart(2, "0");
    return { valor, de, ate: `${alvo.slice(0, 8)}${dia}` };
  };

  m.el.innerHTML = `
    <form id="f-plano" novalidate>
      <label class="campo"><span>Aluno *</span>
        <input type="search" name="busca" placeholder="Digite o nome do aluno…" autocomplete="off"></label>
      <div id="lp-resultados" class="lm-resultados"></div>
      <div id="lp-escolhido"></div>
      <div id="lp-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-cancelar>Cancelar</button>
        <button class="btn" type="submit" disabled>Confirmar</button>
      </div>
    </form>`;
  const form = m.el.querySelector('#f-plano');
  const resultados = m.el.querySelector('#lp-resultados');
  const escolhido = m.el.querySelector('#lp-escolhido');
  const btnOk = form.querySelector('[type=submit]');
  const erro = (t) => { m.el.querySelector('#lp-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();

  form.busca.addEventListener('input', () => {
    const q = semAcento(form.busca.value.trim());
    if (!q) { resultados.innerHTML = ''; return; }
    const achados = lista.filter((a) => semAcento(`${a.nome} ${a.participante_nome || ''}`).includes(q)).slice(0, 8);
    resultados.innerHTML = achados.length
      ? achados.map((a) => `<button type="button" class="lm-item" data-aluno="${a.id}">
          <strong>${esc(a.nome)}</strong>${a.participante_proprio === false && a.participante_nome ? ` <small>(${esc(a.participante_nome)})</small>` : ''}
          <small>${a.matriculas.map((x) => esc(x.aulas?.nome)).join(' · ')}</small></button>`).join('')
      : `<p class="sub" style="margin:0 0 12px">Nenhum aluno com plano ${nomePlano} ativo encontrado.</p>`;
  });
  resultados.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aluno]');
    if (!b) return;
    aluno = alunos.get(b.dataset.aluno);
    mat = aluno.matriculas.length === 1 ? aluno.matriculas[0] : null;
    form.busca.value = aluno.nome;
    resultados.innerHTML = '';
    desenhar();
  });

  function desenhar() {
    erro('');
    let html = '';
    if (aluno.matriculas.length > 1) {
      html += `<fieldset class="vinculo"><legend>Aula *</legend>${aluno.matriculas.map((x) => `
        <label class="check vinculo-opcao"><input type="radio" name="mat" value="${x.id}" ${mat?.id === x.id ? 'checked' : ''}>
          <span>${esc(x.aulas?.nome)}<small>Pago até ${fmtDate(x.data_fim)}</small></span></label>`).join('')}</fieldset>`;
    }
    if (mat) {
      const px = proximo(mat);
      html += `
        <div class="aviso info" style="margin-bottom:14px">${esc(mat.aulas?.nome)} · plano ${nomePlano}<br>
          Período: <strong>${fmtDate(px.de)}</strong> a <strong>${fmtDate(px.ate)}</strong> · valor <strong>${px.valor === null ? 'sem preço' : money(px.valor)}</strong>${mat.valor_personalizado !== null ? ' <span class="badge info">com desconto</span>' : ''}</div>
        <div class="grade2">
          <label class="campo"><span>Dividido em quantas vezes? *</span>
            <input type="number" name="parcelas" min="1" max="24" step="1" value="1" inputmode="numeric" required>
            <small id="lp-parcela"></small></label>
          <label class="campo"><span>Forma de pagamento</span>
            <select name="forma">${FORMAS.map((f) => `<option ${f === 'Cartão de crédito' ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        </div>
        <label class="campo"><span>Data do pagamento</span>
          <input type="date" name="data" value="${hoje}" max="${hoje}"></label>
        <small class="sub">No relatório, o valor entra dividido: uma parcela por mês a partir da data do pagamento.</small>`;
    }
    escolhido.innerHTML = html;
    btnOk.disabled = !mat;
    parcela();
  }
  function parcela() {
    const el = m.el.querySelector('#lp-parcela');
    if (!el || !mat) return;
    const n = Math.max(1, Math.min(24, parseInt(form.parcelas.value, 10) || 1));
    const { valor } = proximo(mat);
    el.textContent = valor && n > 1 ? `${n} × ${money(valor / n)}` : n === 1 ? 'À vista' : '';
  }
  escolhido.addEventListener('change', (e) => {
    if (e.target.name === 'mat') { mat = aluno.matriculas.find((x) => x.id === e.target.value); desenhar(); }
  });
  escolhido.addEventListener('input', (e) => { if (e.target.name === 'parcelas') parcela(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!aluno) return erro('Escolha o aluno.');
    if (!mat) return erro('Escolha a aula.');
    const n = parseInt(form.parcelas.value, 10);
    if (!(n >= 1 && n <= 24)) return erro('Informe em quantas vezes foi dividido (1 a 24).');
    erro('');
    await comBotao(btnOk, async () => {
      try {
        ok(await sb.rpc('lancar_plano', { p_matricula: mat.id, p_parcelas: n, p_forma: form.forma.value, p_data: form.data.value || hoje }));
        m.fechar();
        toast(`Plano ${nomePlano} de ${aluno.nome} lançado${n > 1 ? ` (${n}x)` : ''}.`);
        aoConcluir?.();
      } catch (err) { erro(err.message); }
    });
  });
}

// ------------------------------------------------------------------ comprovante anexado pela equipe
const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** Escolhe uma imagem e anexa como comprovante de uma cobrança paga. */
export function anexarComprovante(pag, aoConcluir) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/') && !TIPOS_IMAGEM.includes(f.type)) return toast('Escolha uma imagem (foto ou print do comprovante).', 'erro');
    try {
      toast('Enviando comprovante…');
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('Sua sessão expirou. Entre de novo.');
      const blob = await reduzirImagem(f, 1600);
      if (!blob) throw new Error('Não foi possível ler esta imagem. Tente outra.');
      const caminho = `${user.id}/${crypto.randomUUID()}.jpg`;
      ok(await sb.storage.from('comprovantes').upload(caminho, blob, { contentType: 'image/jpeg' }));
      ok(await sb.rpc('anexar_comprovante', { p_pagamento: pag.id, p_arquivo: caminho, p_nome: f.name }));
      toast('Comprovante anexado.');
      aoConcluir?.();
    } catch (err) { toast(err.message, 'erro'); }
  };
  input.click();
}

async function verComprovante(arquivo) {
  try {
    const { data, error } = await sb.storage.from('comprovantes').createSignedUrl(arquivo, 3600);
    if (error) throw error;
    window.open(data.signedUrl, '_blank', 'noopener');
  } catch (err) { toast(err.message, 'erro'); }
}

// ------------------------------------------------------------------ página de cobranças
export async function renderCobrancas(el, { navegar }) {
  let aba = 'pendentes';
  let busca = '';
  let dados = [];

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Cobranças</h1><p class="sub">Mensalidades, semestralidades, anuidades e diárias.</p></div>
      <div class="acoes-linha no-print"><button class="btn" type="button" id="lancar-diaria">＋ Lançar diária</button><button class="btn" type="button" id="lancar-mensalidade">＋ Lançar mensal</button><button class="btn" type="button" id="lancar-semestral">＋ Lançar semestral</button><button class="btn" type="button" id="lancar-anual">＋ Lançar anual</button><button class="btn perigo" type="button" id="lancar-reembolso">＋ Lançar reembolso</button></div>
    </div>
    <div id="kpis"></div>
    <div class="filtros">
      <div class="abas" role="tablist">
        <button type="button" data-aba="pendentes" class="atual">Pendentes</button>
        <button type="button" data-aba="atrasadas">Atrasadas</button>
        <button type="button" data-aba="pagas">Pagas</button>
        <button type="button" data-aba="diarias">Diárias</button>
        <button type="button" data-aba="reembolsos">Reembolsos</button>
      </div>
      <input type="text" id="busca" placeholder="Buscar aluno…" aria-label="Buscar aluno">
    </div>
    <div class="card"><div id="lista"></div></div>`;

  const lista = el.querySelector('#lista');
  el.querySelector('#lancar-diaria').onclick = () => lancarDiaria(() => {
    if (aba === 'diarias') carregar();
    else el.querySelector('[data-aba="diarias"]').click();
  });

  const irParaPagas = () => {
    if (aba === 'pagas') carregar();
    else el.querySelector('[data-aba="pagas"]').click();
  };
  el.querySelector('#lancar-mensalidade').onclick = () => lancarMensalidade(irParaPagas);
  el.querySelector('#lancar-semestral').onclick = () => lancarPlano('semestral', irParaPagas);
  el.querySelector('#lancar-anual').onclick = () => lancarPlano('anual', irParaPagas);
  el.querySelector('#lancar-reembolso').onclick = () => lancarReembolso(() => {
    if (aba === 'reembolsos') carregar();
    else el.querySelector('[data-aba="reembolsos"]').click();
  });

  async function carregar() {
    lista.innerHTML = carregando();
    el.querySelector('#busca').placeholder = aba === 'diarias' ? 'Buscar descrição ou modalidade…' : aba === 'reembolsos' ? 'Buscar aluno ou observação…' : 'Buscar aluno…';
    if (aba === 'diarias') return carregarDiarias();
    if (aba === 'reembolsos') return carregarReembolsos();
    try {
      const hoje = hojeISO();
      const base = sb.from('pagamentos').select('*, alunos(id,nome,ativo,telefone,participante_proprio,participante_nome), matriculas(aulas(nome))');
      if (aba === 'pagas') {
        dados = ok(await sb.from('pagamentos').select('*, alunos(id,nome,ativo,telefone,participante_proprio,participante_nome), matriculas(aulas(nome)), comprovantes(id,arquivo)')
          .eq('status', 'pago').order('pago_em', { ascending: false }).limit(200));
      }
      else dados = ok(await base.eq('status', 'pendente').order('vencimento'));
      if (aba === 'atrasadas') dados = dados.filter((p) => p.vencimento < hoje);
      if (aba !== 'pagas') desenharKpis(dados, aba, hoje);
      else el.querySelector('#kpis').innerHTML = '';
      desenharLista();
    } catch (e) {
      lista.innerHTML = erroBox(e);
    }
  }

  async function desenharKpis(d, a, hoje) {
    // Os totais são sempre sobre TODAS as pendentes, independente da aba.
    try {
      const todas = a === 'pendentes' ? d : ok(await sb.from('pagamentos').select('valor,vencimento').eq('status', 'pendente'));
      const atras = todas.filter((p) => p.vencimento < hoje);
      const soma = (arr) => arr.reduce((s, p) => s + Number(p.valor), 0);
      el.querySelector('#kpis').innerHTML = `
        <div class="resumo">
          <div class="kpi"><span>A receber</span><strong>${money(soma(todas))}</strong><small>${todas.length} cobrança(s) pendente(s)</small></div>
          <div class="kpi vermelho"><span>Em atraso</span><strong>${money(soma(atras))}</strong><small>${atras.length} cobrança(s) vencida(s)</small></div>
        </div>`;
    } catch { /* os KPIs são opcionais */ }
  }

  async function carregarDiarias() {
    try {
      dados = ok(await sb.from('diarias').select('*, aulas(nome)').order('data', { ascending: false })
        .order('created_at', { ascending: false }).limit(300));
      const mes = hojeISO().slice(0, 7);
      const doMes = dados.filter((d) => d.data.startsWith(mes));
      const soma = (arr) => arr.reduce((s, d) => s + Number(d.valor), 0);
      el.querySelector('#kpis').innerHTML = `
        <div class="resumo">
          <div class="kpi verde"><span>Diárias no mês</span><strong>${money(soma(doMes))}</strong><small>${doMes.length} diária(s) lançada(s)</small></div>
        </div>`;
      desenharLista();
    } catch (e) {
      lista.innerHTML = erroBox(e);
    }
  }

  function desenharDiarias() {
    const q = busca.trim().toLowerCase();
    const filtrados = dados.filter((d) => !q || `${d.descricao || ''} ${d.aulas?.nome || ''} ${d.forma}`.toLowerCase().includes(q));
    if (!filtrados.length) { lista.innerHTML = vazio('Nenhuma diária lançada. Use “Lançar diária”.'); return; }
    lista.innerHTML = `<div class="tabela-wrap"><table>
      <thead><tr><th>Data</th><th>Modalidade</th><th>Descrição</th><th>Forma</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${filtrados.map((d) => `<tr>
        <td>${fmtDate(d.data)}</td><td>${esc(d.aulas?.nome || '—')}</td><td>${esc(d.descricao || '—')}</td>
        <td>${esc(d.forma)}</td><td class="num">${money(d.valor)}</td>
        <td class="num"><button class="btn sec perigo pequeno" type="button" data-excluir-diaria="${d.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  async function carregarReembolsos() {
    try {
      dados = ok(await sb.from('reembolsos').select('*, alunos(id,nome,participante_proprio,participante_nome)')
        .order('data', { ascending: false }).order('created_at', { ascending: false }).limit(300));
      const mes = hojeISO().slice(0, 7);
      const doMes = dados.filter((d) => d.data.startsWith(mes));
      el.querySelector('#kpis').innerHTML = `
        <div class="resumo">
          <div class="kpi vermelho"><span>Reembolsos no mês</span><strong>${money(doMes.reduce((s, d) => s + Number(d.valor), 0))}</strong><small>${doMes.length} reembolso(s) · descontados do total recebido</small></div>
        </div>`;
      desenharLista();
    } catch (e) {
      lista.innerHTML = erroBox(e);
    }
  }

  function desenharReembolsos() {
    const q = busca.trim().toLowerCase();
    const filtrados = dados.filter((d) => !q || `${d.alunos?.nome || ''} ${d.alunos?.participante_nome || ''} ${d.observacao || ''}`.toLowerCase().includes(q));
    if (!filtrados.length) { lista.innerHTML = vazio('Nenhum reembolso lançado. Use “Lançar reembolso”.'); return; }
    lista.innerHTML = `<div class="tabela-wrap"><table>
      <thead><tr><th>Data</th><th>Aluno</th><th>Observações</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${filtrados.map((d) => `<tr>
        <td>${fmtDate(d.data)}</td>
        <td>${d.alunos ? `<a href="#/alunos/${d.alunos.id}">${esc(nomeParticipante(d.alunos))}</a>` : '—'}</td>
        <td>${esc(d.observacao || '—')}</td>
        <td class="num" style="color:var(--erro)">− ${money(d.valor)}</td>
        <td class="num"><button class="btn sec perigo pequeno" type="button" data-excluir-reembolso="${d.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function desenharLista() {
    if (aba === 'diarias') return desenharDiarias();
    if (aba === 'reembolsos') return desenharReembolsos();
    const q = busca.trim().toLowerCase();
    const filtrados = dados.filter((p) => !q || `${p.alunos?.nome || ''} ${p.alunos?.participante_nome || ''}`.toLowerCase().includes(q));
    if (!filtrados.length) {
      lista.innerHTML = vazio(aba === 'pagas' ? 'Nenhum pagamento registrado.' : aba === 'atrasadas' ? 'Nenhuma cobrança em atraso. 🎉' : 'Nenhuma cobrança pendente.');
      return;
    }
    const hoje = hojeISO();
    lista.innerHTML = `<div class="tabela-wrap"><table>
      <thead><tr><th>Aluno</th><th>Aula</th><th>Plano</th><th>Referência</th><th class="num">Valor</th>
        <th>${aba === 'pagas' ? 'Pago em' : 'Vencimento'}</th><th>${aba === 'pagas' ? 'Forma' : 'Situação'}</th><th></th></tr></thead>
      <tbody>${filtrados.map((p) => {
        const atraso = p.status === 'pendente' && p.vencimento < hoje;
        const dias = atraso ? diasEntre(p.vencimento, hoje) : 0;
        return `<tr>
          <td><a href="#/alunos/${p.alunos?.id}">${esc(p.alunos ? nomeParticipante(p.alunos) : '')}</a>${p.alunos && nomeParticipante(p.alunos) !== p.alunos.nome ? `<br><small class="sub">resp.: ${esc(p.alunos.nome)}</small>` : ''}${p.alunos?.ativo === false ? ' <span class="badge cinza">Desativado</span>' : ''}</td>
          <td>${esc(p.matriculas?.aulas?.nome)}</td>
          <td>${esc(planoLabel(p.plano))}</td>
          <td>${fmtMes(p.competencia)}</td>
          <td class="num">${money(p.valor)}</td>
          <td>${fmtDate(aba === 'pagas' ? p.pago_em : p.vencimento)}</td>
          <td>${aba === 'pagas' ? `${esc(p.forma || '—')}${p.parcelas > 1 ? ` <span class="badge info">${p.parcelas}x</span>` : ''}`
            : atraso ? `<span class="badge erro">${dias} dia(s) de atraso</span>`
            : p.vencimento === hoje ? '<span class="badge alerta">Vence hoje</span>' : '<span class="badge">A vencer</span>'}</td>
          <td class="num acoes-cobranca">${(() => { const z = p.status === 'pendente' && linkCobrancaWhatsApp({ valor: p.valor, vencimento: p.vencimento, aula: p.matriculas?.aulas?.nome }, p.alunos); return z ? `<a class="btn pequeno whats" href="${esc(z)}" target="_blank" rel="noopener" title="Enviar a cobrança pelo WhatsApp">${ICONE_WHATSAPP}Cobrar</a> ` : ''; })()}${p.status === 'pendente' ? `<button class="btn pequeno" type="button" data-pagar="${p.id}">Registrar pagamento</button>` : ''}${p.status === 'pago' ? `${(p.comprovantes || []).map((c, i) => `<button class="btn sec pequeno btn-comp" type="button" data-ver-comp="${esc(c.arquivo)}" title="Ver comprovante">📎 Ver${p.comprovantes.length > 1 ? ` ${i + 1}` : ''}</button> `).join('')}<button class="btn sec pequeno btn-comp btn-mais" type="button" data-anexar="${p.id}" title="Adicionar comprovante (imagem)" aria-label="Adicionar comprovante">+</button>` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  el.querySelector('.abas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aba]');
    if (!b) return;
    aba = b.dataset.aba;
    el.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('atual', x === b));
    carregar();
  });
  el.querySelector('#busca').addEventListener('input', (e) => { busca = e.target.value; desenharLista(); });
  lista.addEventListener('click', async (e) => {
    const ex = e.target.closest('[data-excluir-diaria]');
    if (ex) {
      const d = dados.find((x) => x.id === ex.dataset.excluirDiaria);
      if (!(await confirmar(`Excluir a diária de ${money(d.valor)} lançada em ${fmtDate(d.data)}?`, { titulo: 'Excluir diária', confirmarTexto: 'Excluir', perigo: true }))) return;
      await comBotao(ex, async () => {
        ok(await sb.from('diarias').delete().eq('id', d.id));
        toast('Diária excluída.');
        carregar();
      });
      return;
    }
    const exr = e.target.closest('[data-excluir-reembolso]');
    if (exr) {
      const d = dados.find((x) => x.id === exr.dataset.excluirReembolso);
      if (!(await confirmar(`Excluir o reembolso de ${money(d.valor)} lançado em ${fmtDate(d.data)}?`, { titulo: 'Excluir reembolso', confirmarTexto: 'Excluir', perigo: true }))) return;
      await comBotao(exr, async () => {
        ok(await sb.from('reembolsos').delete().eq('id', d.id));
        toast('Reembolso excluído.');
        carregar();
      });
      return;
    }
    const ver = e.target.closest('[data-ver-comp]');
    if (ver) return verComprovante(ver.dataset.verComp);
    const anexar = e.target.closest('[data-anexar]');
    if (anexar) return anexarComprovante(dados.find((x) => x.id === anexar.dataset.anexar), carregar);
    const b = e.target.closest('[data-pagar]');
    if (!b) return;
    const p = dados.find((x) => x.id === b.dataset.pagar);
    registrarPagamento(dadosParaPagamento(p), carregar);
  });

  carregar();
}
