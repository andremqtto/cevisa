// Relatório mensal de entradas: visão geral e por modalidade (aula).
import { sb, ok } from './supabase.js';
import { esc, money, fmtDate, planoLabel, fmtMesLongo, hojeISO, carregando, vazio, erroBox } from './ui.js';
import { registrarPagamento } from './financeiro.js';

export async function renderRelatorios(el) {
  const hoje = hojeISO();
  let mes = hoje.slice(0, 7); // YYYY-MM
  let aba = 'geral';
  let ultimo = null;

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Relatório mensal</h1><p class="sub">Entradas, diárias, reembolsos, planos contratados e inadimplência do mês.</p></div>
      <div class="acoes-linha no-print">
        <label class="campo" style="margin:0"><span class="sr" style="position:absolute;left:-9999px">Mês</span>
          <input type="month" id="mes" value="${mes}" aria-label="Mês do relatório"></label>
        <button class="btn sec" type="button" id="imprimir">Imprimir</button>
      </div>
    </div>
    <div class="abas sub-abas no-print" role="tablist">
      <button type="button" data-aba="geral" class="atual">Geral</button>
      <button type="button" data-aba="modalidades">Modalidades</button>
    </div>
    <div id="rel"></div>`;
  const rel = el.querySelector('#rel');

  async function carregar() {
    rel.innerHTML = carregando('Gerando relatório…');
    const [ano, m] = mes.split('-').map(Number);
    try {
      ultimo = { r: ok(await sb.rpc('relatorio_mensal', { p_ano: ano, p_mes: m })), ano, m };
      desenhar();
    } catch (e) { rel.innerHTML = erroBox(e); }
  }

  function desenhar() {
    const { r, ano, m } = ultimo;
    const titulo = `<h2 style="margin-bottom:14px">${esc(fmtMesLongo(ano, m).replace(/^./, (c) => c.toUpperCase()))}${aba === 'modalidades' ? ' · por modalidade' : ''}</h2>`;
    rel.innerHTML = titulo + (aba === 'geral' ? geral(r) : modalidades(r));
    rel.querySelectorAll('[data-pagar]').forEach((b) => b.addEventListener('click', () => {
      const d = r.em_debito.find((x) => x.pagamento_id === b.dataset.pagar);
      registrarPagamento({ id: d.pagamento_id, aluno_id: d.aluno_id, aluno_nome: d.aluno, plano: d.plano, valor: d.valor, vencimento: d.vencimento }, carregar);
    }));
  }

  // ---------------------------------------------------------------- Geral
  function geral(r) {
    const totalPlanos = r.planos.reduce((s, p) => s + p.qtd, 0);
    const debito = r.em_debito.reduce((s, d) => s + Number(d.valor), 0);
    const diarias = Number(r.diarias || 0);
    const listaDiarias = r.diarias_lista || [];
    const reembolsos = Number(r.reembolsos || 0);
    const listaReemb = r.reembolsos_lista || [];
    return `
      <div class="resumo">
        <div class="kpi"><span>Novos alunos</span><strong>${r.novos_alunos}</strong><small>cadastrados no mês</small></div>
        <div class="kpi"><span>Planos contratados</span><strong>${totalPlanos}</strong>
          <small>${r.planos.length ? r.planos.map((p) => `${p.qtd} ${planoLabel(p.plano).toLowerCase()}`).join(' · ') : 'nenhum no mês'}</small></div>
        <div class="kpi verde"><span>Mensalidades recebidas</span><strong>${money(r.recebido)}</strong><small>${r.recebimentos.length} pagamento(s) no mês${r.recebimentos.some((p) => p.parcelas > 1) ? ' · cartão parcelado conta 1 parcela por mês' : ''}</small></div>
        <div class="kpi verde"><span>Diárias recebidas</span><strong>${money(diarias)}</strong><small>${listaDiarias.length} diária(s) no mês</small></div>
        <div class="kpi vermelho"><span>Reembolsos</span><strong>− ${money(reembolsos)}</strong><small>${listaReemb.length} reembolso(s) no mês</small></div>
        <div class="kpi verde"><span>Total recebido (líquido)</span><strong>${money(Number(r.recebido) + diarias - reembolsos)}</strong><small>mensalidades + diárias − reembolsos</small></div>
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
            <td>${planoLabel(p.plano)}</td>
            <td>${esc(p.forma || '—')}${p.parcelas > 1 ? `<br><small class="sub">parcela ${p.parcela}/${p.parcelas} · total ${money(p.valor_total)}</small>` : ''}</td>
            <td class="num">${money(p.valor)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="num"><strong>${money(r.recebido)}</strong></td></tr></tfoot></table></div>`
          : vazio('Nenhum pagamento recebido neste mês.')}
      </section>

      <section class="card">
        <h2>Diárias recebidas no mês</h2>
        ${listaDiarias.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Data</th><th>Modalidade</th><th>Descrição</th><th>Forma</th><th class="num">Valor</th></tr></thead>
          <tbody>${listaDiarias.map((d) => `<tr>
            <td>${fmtDate(d.data)}</td><td>${esc(d.aula || '—')}</td><td>${esc(d.descricao || '—')}</td>
            <td>${esc(d.forma)}</td><td class="num">${money(d.valor)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="num"><strong>${money(diarias)}</strong></td></tr></tfoot></table></div>`
          : vazio('Nenhuma diária lançada neste mês.')}
      </section>

      <section class="card">
        <h2>Reembolsos no mês</h2>
        ${listaReemb.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Data</th><th>Aluno</th><th>Observações</th><th class="num">Valor</th></tr></thead>
          <tbody>${listaReemb.map((d) => `<tr>
            <td>${fmtDate(d.data)}</td><td>${d.aluno_id ? `<a href="#/alunos/${d.aluno_id}">${esc(d.aluno)}</a>` : '—'}</td>
            <td>${esc(d.observacao || '—')}</td><td class="num" style="color:var(--erro)">− ${money(d.valor)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="num" style="color:var(--erro)"><strong>− ${money(reembolsos)}</strong></td></tr></tfoot></table></div>`
          : vazio('Nenhum reembolso neste mês.')}
      </section>`;
  }

  // ---------------------------------------------------------------- Modalidades
  function modalidades(r) {
    // Todas as modalidades (aulas) aparecem, mesmo as que ainda não têm valores no mês.
    const mods = r.modalidades || [];
    const semMod = Number(r.diarias_sem_modalidade || 0);
    const reemb = Number(r.reembolsos || 0);
    if (!mods.length && !semMod) return vazio('Nenhuma modalidade cadastrada. Crie as aulas na tela inicial.');
    const soma = (k) => mods.reduce((s, x) => s + Number(x[k] || 0), 0);
    const maior = Math.max(1, ...mods.map((x) => Number(x.recebido) + Number(x.diarias)));
    return `
      <div class="grade-modalidades">${mods.map((x) => {
        const total = Number(x.recebido) + Number(x.diarias);
        return `
        <section class="card modalidade">
          <header><h3>${esc(x.aula)}</h3><strong>${money(total)}</strong></header>
          <div class="barra" aria-hidden="true"><span style="width:${Math.round((total / maior) * 100)}%"></span></div>
          <dl class="linhas">
            <div><dt>Mensalidades recebidas</dt><dd>${money(x.recebido)} <small class="sub">(${x.pagamentos})</small></dd></div>
            <div><dt>Diárias</dt><dd>${money(x.diarias)} <small class="sub">(${x.qtd_diarias})</small></dd></div>
            <div><dt>A receber no mês</dt><dd>${money(x.a_receber)}</dd></div>
            <div><dt>Em débito</dt><dd>${Number(x.em_debito) ? `<span class="badge erro">${money(x.em_debito)}</span>` : money(0)}</dd></div>
            <div><dt>Alunos ativos</dt><dd>${x.alunos_ativos}${x.na_espera ? ` · ${x.na_espera} na fila` : ''}</dd></div>
            <div><dt>Novas matrículas</dt><dd>${x.novas_matriculas}</dd></div>
          </dl>
        </section>`;
      }).join('')}</div>

      <section class="card">
        <h2>Comparativo</h2>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Modalidade</th><th class="num">Alunos ativos</th><th class="num">Mensalidades</th><th class="num">Diárias</th><th class="num">Total recebido</th><th class="num">A receber</th><th class="num">Em débito</th></tr></thead>
          <tbody>${mods.map((x) => `<tr>
            <td><strong>${esc(x.aula)}</strong></td><td class="num">${x.alunos_ativos}</td>
            <td class="num">${money(x.recebido)}</td><td class="num">${money(x.diarias)}</td>
            <td class="num"><strong>${money(Number(x.recebido) + Number(x.diarias))}</strong></td>
            <td class="num">${money(x.a_receber)}</td><td class="num">${money(x.em_debito)}</td></tr>`).join('')}
            ${semMod ? `<tr><td><em>Diárias sem modalidade</em></td><td class="num">—</td><td class="num">—</td>
              <td class="num">${money(semMod)}</td><td class="num"><strong>${money(semMod)}</strong></td><td class="num">—</td><td class="num">—</td></tr>` : ''}
            ${reemb ? `<tr><td><em>Reembolsos (saídas)</em></td><td class="num">—</td><td class="num">—</td><td class="num">—</td>
              <td class="num" style="color:var(--erro)"><strong>− ${money(reemb)}</strong></td><td class="num">—</td><td class="num">—</td></tr>` : ''}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td class="num"><strong>${soma('alunos_ativos')}</strong></td>
            <td class="num"><strong>${money(soma('recebido'))}</strong></td><td class="num"><strong>${money(soma('diarias') + semMod)}</strong></td>
            <td class="num"><strong>${money(soma('recebido') + soma('diarias') + semMod - reemb)}</strong></td>
            <td class="num"><strong>${money(soma('a_receber'))}</strong></td><td class="num"><strong>${money(soma('em_debito'))}</strong></td></tr></tfoot>
        </table></div>
      </section>`;
  }

  el.querySelector('.sub-abas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aba]');
    if (!b || b.dataset.aba === aba) return;
    aba = b.dataset.aba;
    el.querySelectorAll('.sub-abas button').forEach((x) => x.classList.toggle('atual', x === b));
    if (ultimo) desenhar();
  });
  el.querySelector('#mes').addEventListener('change', (e) => { if (e.target.value) { mes = e.target.value; carregar(); } });
  el.querySelector('#imprimir').addEventListener('click', () => window.print());
  carregar();
}
