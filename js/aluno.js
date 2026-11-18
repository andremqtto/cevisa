// Painel do aluno: aulas contratadas, horários, valores, vencimento e aviso de pagamento.
import { sb, ok } from './supabase.js';
import {
  esc, money, fmtDate, planoLabel, hojeISO, diasEntre, abrirModal, toast, comBotao, carregando, vazio, erroBox,
  linkWhatsApp, horariosHTML, ICONE_WHATSAPP,
} from './ui.js';

const DIAS_A_VISTA = 30; // mensalidades que vencem em até 30 dias entram no "total a pagar"

export async function renderPainelAluno(el) {
  el.innerHTML = carregando('Carregando seu painel…');
  let alunos;
  try {
    alunos = ok(await sb.rpc('painel_aluno')) || [];
  } catch (e) { el.innerHTML = erroBox(e); return; }

  const hoje = hojeISO();
  const varios = alunos.length > 1;

  // Cada matrícula ativa vira um item com valor e vencimento:
  // cobrança pendente (se já gerada) ou, senão, o preço do plano com vencimento no fim do período pago.
  const itens = [];
  for (const a of alunos) {
    for (const m of a.matriculas) {
      if (m.status !== 'ativa') continue;
      const valor = m.pendente ? Number(m.pendente.valor) : (m.preco === null ? null : Number(m.preco));
      const venc = m.pendente ? m.pendente.vencimento : m.data_fim;
      itens.push({ matricula: m.id, aluno: a.nome, aula: m.aula, plano: m.plano, valor, venc });
    }
  }
  const aPagar = itens.filter((i) => diasEntre(hoje, i.venc) <= DIAS_A_VISTA);
  const total = aPagar.reduce((t, i) => t + (i.valor || 0), 0);
  const vencimento = aPagar.map((i) => i.venc).sort()[0] || null;
  const proximo = itens.map((i) => i.venc).sort()[0] || null;
  const porMatricula = Object.fromEntries(itens.map((i) => [i.matricula, i]));

  // Aviso já enviado e ainda não confirmado pelo gestor?
  const informado = alunos
    .filter((a) => a.pagamento_informado_em && (!a.ultimo_pagamento || a.pagamento_informado_em.slice(0, 10) > a.ultimo_pagamento))
    .map((a) => a.pagamento_informado_em).sort().pop();

  const nome = (alunos[0]?.nome || '').split(' ')[0];
  const inativo = alunos.some((a) => !a.ativo);
  const temAulas = alunos.some((a) => a.matriculas.length);

  let situacaoVenc = '';
  if (vencimento) {
    const d = diasEntre(hoje, vencimento);
    situacaoVenc = d < 0 ? `<span class="badge erro">Em atraso há ${-d} dia(s)</span>`
      : d === 0 ? '<span class="badge alerta">Vence hoje</span>'
      : d <= 7 ? `<span class="badge alerta">Vence em ${d} dia(s)</span>`
      : `<span class="badge ok">Vence em ${d} dias</span>`;
  }

  el.innerHTML = `
    <div class="pagina-topo">
      <div>
        <h1>Olá, ${esc(nome)}!</h1>
        <p class="sub">Este é o seu painel de aluno${varios ? ` (${alunos.map((a) => esc(a.nome.split(' ')[0])).join(', ')})` : ''}.</p>
      </div>
    </div>

    ${inativo ? '<div class="aviso alerta">Há um cadastro desativado. Fale com o gestor para regularizar.</div>' : ''}
    ${informado ? `<div class="aviso info">Você avisou o pagamento em ${fmtDate(informado.slice(0, 10))}. Assim que o gestor confirmar, este painel será atualizado.</div>` : ''}

    <section class="painel-resumo">
      <div>
        ${aPagar.length ? `
          <span class="rotulo">Total a pagar</span>
          <strong class="total">${money(total)}</strong>
          <div class="venc">Vencimento: <strong>${fmtDate(vencimento)}</strong> ${situacaoVenc}</div>`
        : itens.length ? `
          <span class="rotulo">Mensalidades</span>
          <strong class="total total-ok">Em dia</strong>
          <div class="venc">Próximo vencimento: <strong>${fmtDate(proximo)}</strong></div>`
        : `
          <span class="rotulo">Mensalidades</span>
          <strong class="total total-ok">Nada a pagar</strong>
          <div class="venc">Você não tem planos ativos no momento.</div>`}
      </div>
      <div class="painel-botoes">
        <button class="btn claro" type="button" id="ja-paguei" ${itens.length ? '' : 'disabled'}>Já paguei</button>
        <a class="btn sec-claro" id="falar" href="${esc(linkWhatsApp(`Olá! Sou ${alunos[0]?.nome || ''}, aluno(a) do Cevisa.`) || '#')}" target="_blank" rel="noopener">${ICONE_WHATSAPP}Falar com o gestor</a>
      </div>
    </section>

    <h2 class="secao-titulo">Minhas aulas</h2>
    ${temAulas ? `<div class="minhas-aulas">${alunos.flatMap((a) => a.matriculas.map((m) => cartaoAula(a, m, porMatricula[m.id], varios, hoje))).join('')}</div>`
      : `<div class="card">${vazio('Você ainda não está inscrito em nenhuma aula. Fale com a recepção para se inscrever.')}</div>`}`;

  el.querySelector('#ja-paguei').onclick = () => informarPagamento({ total, vencimento: vencimento || proximo, aPagar }, () => renderPainelAluno(el));
  const falar = el.querySelector('#falar');
  if (falar.getAttribute('href') === '#') {
    falar.addEventListener('click', (e) => { e.preventDefault(); toast('O contato do gestor ainda não foi configurado. Procure a recepção.', 'erro'); });
  }
}

function cartaoAula(aluno, m, item, varios, hoje) {
  const espera = m.status === 'espera';
  let pagoAte = '';
  if (!espera) {
    const d = diasEntre(hoje, m.data_fim);
    pagoAte = `${fmtDate(m.data_fim)} ${d < 0 ? '<span class="badge erro">vencido</span>' : d <= 7 ? '<span class="badge alerta">vence logo</span>' : ''}`;
  }
  return `
    <article class="minha-aula">
      <header>
        <h3>${esc(m.aula)}</h3>
        ${espera ? '<span class="badge alerta">Lista de espera</span>' : `<span class="badge">${planoLabel(m.plano)}</span>`}
      </header>
      ${varios ? `<p class="sub" style="margin:0">Aluno: <strong>${esc(aluno.nome)}</strong></p>` : ''}
      ${horariosHTML(m.horarios) || '<p class="sub" style="margin:0">Horários a confirmar com a recepção.</p>'}
      <dl class="linhas">
        ${espera ? '<div><dt>Situação</dt><dd>Aguardando vaga</dd></div>' : `
          <div><dt>Valor do plano</dt><dd>${m.preco === null ? 'a combinar' : money(m.preco)}</dd></div>
          ${item?.valor !== null && item && Number(item.valor) !== Number(m.preco) ? `<div><dt>Próxima cobrança</dt><dd>${money(item.valor)}</dd></div>` : ''}
          <div><dt>Pago até</dt><dd>${pagoAte}</dd></div>`}
      </dl>
    </article>`;
}

function informarPagamento({ total, vencimento, aPagar }, aoConcluir) {
  const m = abrirModal({
    titulo: 'Avisar pagamento',
    largura: 460,
    corpo: `
      <form id="f-pago" novalidate>
        <p style="margin-top:0">O gestor vai receber um aviso de que você pagou${aPagar.length ? ` <strong>${money(total)}</strong> (vencimento ${fmtDate(vencimento)})` : ''}.
          O pagamento só aparece como confirmado depois que ele conferir.</p>
        <label class="campo"><span>Como você pagou?</span>
          <select name="forma">
            <option value="Pix">Pix</option>
            <option value="Dinheiro">Dinheiro</option>
            <option value="Cartão">Cartão</option>
            <option value="Transferência">Transferência</option>
            <option value="Outro">Outro</option>
          </select></label>
        <label class="campo"><span>Observação (opcional)</span><textarea name="obs" maxlength="300" placeholder="Ex.: paguei no Pix em nome da minha mãe"></textarea></label>
        <div id="p-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Avisar o gestor</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-pago');
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.rpc('informar_pagamento', { p_forma: form.forma.value, p_obs: form.obs.value }));
        m.fechar();
        toast('Pronto! O gestor foi avisado do seu pagamento.');
        aoConcluir();
      } catch (err) {
        m.el.querySelector('#p-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
      }
    });
  });
}
