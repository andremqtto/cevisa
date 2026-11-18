// Relatório mensal de entradas.
import { sb, ok } from './supabase.js';
import { esc, money, fmtDate, planoLabel, fmtMesLongo, hojeISO, carregando, vazio, erroBox } from './ui.js';
import { registrarPagamento } from './financeiro.js';

export async function renderRelatorios(el) {
  const hoje = hojeISO();
  let mes = hoje.slice(0, 7); // YYYY-MM

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Relatório mensal</h1><p class="sub">Entradas, planos contratados e inadimplência do mês.</p></div>
      <div class="acoes-linha no-print">
        <label class="campo" style="margin:0"><span class="sr" style="position:absolute;left:-9999px">Mês</span>
          <input type="month" id="mes" value="${mes}" aria-label="Mês do relatório"></label>
        <button class="btn sec" type="button" id="imprimir">Imprimir</button>
      </div>
    </div>
    <div id="rel"></div>`;
  const rel = el.querySelector('#rel');

  async function carregar() {
    rel.innerHTML = carregando('Gerando relatório…');
    const [ano, m] = mes.split('-').map(Number);
    try {
      const r = ok(await sb.rpc('relatorio_mensal', { p_ano: ano, p_mes: m }));
      desenhar(r, ano, m);
    } catch (e) { rel.innerHTML = erroBox(e); }
  }

  function desenhar(r, ano, m) {
    const totalPlanos = r.planos.reduce((s, p) => s + p.qtd, 0);
    const debito = r.em_debito.reduce((s, d) => s + Number(d.valor), 0);
    rel.innerHTML = `
      <h2 style="margin-bottom:14px">${esc(fmtMesLongo(ano, m).replace(/^./, (c) => c.toUpperCase()))}</h2>
      <div class="resumo">
        <div class="kpi"><span>Novos alunos</span><strong>${r.novos_alunos}</strong><small>cadastrados no mês</small></div>
        <div class="kpi"><span>Planos contratados</span><strong>${totalPlanos}</strong>
          <small>${r.planos.length ? r.planos.map((p) => `${p.qtd} ${planoLabel(p.plano).toLowerCase()}`).join(' · ') : 'nenhum no mês'}</small></div>
        <div class="kpi verde"><span>Já recebido</span><strong>${money(r.recebido)}</strong><small>${r.recebimentos.length} pagamento(s) no mês</small></div>
        <div class="kpi"><span>A receber</span><strong>${money(r.a_receber)}</strong><small>cobranças pendentes com vencimento no mês</small></div>
        <div class="kpi vermelho"><span>Em débito</span><strong>${money(debito)}</strong><small>${r.em_debito.length} aluno(s) com cobrança vencida no mês</small></div>
      </div>

      <section class="card">
        <h2>Alunos em débito</h2>
        ${r.em_debito.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Aluno</th><th>Telefone</th><th>Plano</th><th>Vencimento</th><th>Atraso</th><th class="num">Valor</th><th></th></tr></thead>
          <tbody>${r.em_debito.map((d) => `<tr>
            <td><a href="#/alunos/${d.aluno_id}">${esc(d.aluno)}</a></td><td>${esc(d.telefone || '—')}</td>
            <td>${planoLabel(d.plano)}</td><td>${fmtDate(d.vencimento)}</td>
            <td><span class="badge erro">${d.dias_atraso} dia(s)</span></td><td class="num">${money(d.valor)}</td>
            <td class="num"><button class="btn pequeno no-print" type="button" data-pagar="${d.pagamento_id}">Registrar pagamento</button></td></tr>`).join('')}</tbody></table></div>`
          : vazio('Ninguém em débito neste mês. 🎉')}
      </section>

      <section class="card">
        <h2>Pagamentos recebidos no mês</h2>
        ${r.recebimentos.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Data</th><th>Aluno</th><th>Plano</th><th>Forma</th><th class="num">Valor</th></tr></thead>
          <tbody>${r.recebimentos.map((p) => `<tr>
            <td>${fmtDate(p.pago_em)}</td><td><a href="#/alunos/${p.aluno_id}">${esc(p.aluno)}</a></td>
            <td>${planoLabel(p.plano)}</td><td>${esc(p.forma || '—')}</td><td class="num">${money(p.valor)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="num"><strong>${money(r.recebido)}</strong></td></tr></tfoot></table></div>`
          : vazio('Nenhum pagamento recebido neste mês.')}
      </section>`;

    rel.querySelectorAll('[data-pagar]').forEach((b) => b.addEventListener('click', () => {
      const d = r.em_debito.find((x) => x.pagamento_id === b.dataset.pagar);
      registrarPagamento({ id: d.pagamento_id, aluno_id: d.aluno_id, aluno_nome: d.aluno, plano: d.plano, valor: d.valor, vencimento: d.vencimento }, carregar);
    }));
  }

  el.querySelector('#mes').addEventListener('change', (e) => { if (e.target.value) { mes = e.target.value; carregar(); } });
  el.querySelector('#imprimir').addEventListener('click', () => window.print());
  carregar();
}
