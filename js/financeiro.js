// Cobranças (pagamentos pendentes/pagos) e o diálogo de registrar pagamento.
import { sb, ok } from './supabase.js';
import {
  esc, money, fmtDate, fmtMes, planoLabel, hojeISO, diasEntre, abrirModal, toast, confirmar,
  comBotao, carregando, vazio, erroBox,
} from './ui.js';

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

// ------------------------------------------------------------------ página de cobranças
export async function renderCobrancas(el, { navegar }) {
  let aba = 'pendentes';
  let busca = '';
  let dados = [];

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Cobranças</h1><p class="sub">Mensalidades, semestralidades, anuidades e diárias.</p></div>
      <div class="acoes-linha no-print"><button class="btn" type="button" id="lancar-diaria">＋ Lançar diária</button></div>
    </div>
    <div id="kpis"></div>
    <div class="filtros">
      <div class="abas" role="tablist">
        <button type="button" data-aba="pendentes" class="atual">Pendentes</button>
        <button type="button" data-aba="atrasadas">Atrasadas</button>
        <button type="button" data-aba="pagas">Pagas</button>
        <button type="button" data-aba="diarias">Diárias</button>
      </div>
      <input type="text" id="busca" placeholder="Buscar aluno…" aria-label="Buscar aluno">
    </div>
    <div class="card"><div id="lista"></div></div>`;

  const lista = el.querySelector('#lista');
  el.querySelector('#lancar-diaria').onclick = () => lancarDiaria(() => {
    if (aba === 'diarias') carregar();
    else el.querySelector('[data-aba="diarias"]').click();
  });

  async function carregar() {
    lista.innerHTML = carregando();
    el.querySelector('#busca').placeholder = aba === 'diarias' ? 'Buscar descrição ou modalidade…' : 'Buscar aluno…';
    if (aba === 'diarias') return carregarDiarias();
    try {
      const hoje = hojeISO();
      const base = sb.from('pagamentos').select('*, alunos(id,nome,ativo), matriculas(aulas(nome))');
      if (aba === 'pagas') dados = ok(await base.eq('status', 'pago').order('pago_em', { ascending: false }).limit(200));
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

  function desenharLista() {
    if (aba === 'diarias') return desenharDiarias();
    const q = busca.trim().toLowerCase();
    const filtrados = dados.filter((p) => !q || (p.alunos?.nome || '').toLowerCase().includes(q));
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
          <td><a href="#/alunos/${p.alunos?.id}">${esc(p.alunos?.nome)}</a>${p.alunos?.ativo === false ? ' <span class="badge cinza">Desativado</span>' : ''}</td>
          <td>${esc(p.matriculas?.aulas?.nome)}</td>
          <td>${esc(planoLabel(p.plano))}</td>
          <td>${fmtMes(p.competencia)}</td>
          <td class="num">${money(p.valor)}</td>
          <td>${fmtDate(aba === 'pagas' ? p.pago_em : p.vencimento)}</td>
          <td>${aba === 'pagas' ? esc(p.forma || '—')
            : atraso ? `<span class="badge erro">${dias} dia(s) de atraso</span>`
            : p.vencimento === hoje ? '<span class="badge alerta">Vence hoje</span>' : '<span class="badge">A vencer</span>'}</td>
          <td class="num">${p.status === 'pendente' ? `<button class="btn pequeno" type="button" data-pagar="${p.id}">Registrar pagamento</button>` : ''}</td>
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
    const b = e.target.closest('[data-pagar]');
    if (!b) return;
    const p = dados.find((x) => x.id === b.dataset.pagar);
    registrarPagamento(dadosParaPagamento(p), carregar);
  });

  carregar();
}
