// Painel do aluno: aulas contratadas, horários, valores, vencimento e aviso de pagamento.
import { sb, ok, chamarFuncao } from './supabase.js';
import * as config from './config.js';
import { avatarHTML, ativarFotos } from './fotos.js';
import { codigoPix, qrSVG } from './pix.js';
import {
  esc, money, fmtDate, planoLabel, PLANOS, hojeISO, diasEntre, abrirModal, toast, comBotao, carregando, vazio, erroBox,
  fmtMes, fmtMesLongo, primeiroDiaMes,
  horariosHTML, precoVinculo, moneyOuIsento, VINCULOS, ICONE_WHATSAPP,
} from './ui.js';

// Nome de quem faz as aulas (dependente) ou, se for o próprio responsável, o nome do cadastro.
const quem = (a) => a.participante || a.nome;

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
  const aPagar = itens.filter((i) => i.valor !== 0 && diasEntre(hoje, i.venc) <= DIAS_A_VISTA); // valor zero (funcionário) não é cobrado
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
      <div class="com-avatar">
        <div class="fotos-painel">${alunos.map((a) => avatarHTML(a.foto, quem(a), varios ? 48 : 60)).join('')}</div>
        <div>
        <h1>Olá, ${esc(nome)}!</h1>
        <p class="sub">Este é o seu painel${alunos.some((a) => quem(a) !== a.nome) || varios ? ` · aulas de ${alunos.map((a) => esc(quem(a).split(' ')[0])).join(', ')}` : ' de aluno'}.</p>
        </div>
      </div>
    </div>

    ${inativo ? '<div class="aviso alerta">Há um cadastro desativado. Fale com o gestor para regularizar.</div>' : ''}
    ${alunos.flatMap((a) => (a.solicitacoes || []).map((s) => `<div class="aviso info">Pedido de inscrição em <strong>${esc(s.aula)}${s.turma ? ` — ${esc(s.turma)}` : ''}</strong> (plano ${planoLabel(s.plano)})${varios || quem(a) !== a.nome ? ` para ${esc(quem(a).split(' ')[0])}` : ''} enviado em ${fmtDate(s.created_at.slice(0, 10))}. Aguardando a recepção confirmar.</div>`)).join('')}
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
        ${config.PIX_CHAVE ? `<button class="btn pix" type="button" id="pagar-pix">${ICONE_PIX}Pagar com Pix</button>` : ''}
        <button class="btn claro" type="button" id="ja-paguei" ${itens.length ? '' : 'disabled'}>Já paguei</button>
        <button class="btn sec-claro" type="button" id="comprovante" ${alunos.length ? '' : 'disabled'}>${ICONE_CLIPE}Enviar comprovante</button>
      </div>
    </section>

    <h2 class="secao-titulo">Minhas aulas</h2>
    ${temAulas ? `<div class="minhas-aulas">${alunos.flatMap((a) => a.matriculas.map((m) => cartaoAula(a, m, porMatricula[m.id], varios, hoje))).join('')}</div>`
      : `<div class="card">${vazio('Você ainda não está inscrito em nenhuma aula.')}<p style="text-align:center;margin:0 0 6px"><a class="btn" href="#/aulas">Ver aulas e me inscrever</a></p></div>`}`;

  el.querySelector('#ja-paguei').onclick = () => informarPagamento({ total, vencimento: vencimento || proximo, aPagar }, () => renderPainelAluno(el));
  ativarFotos(el);
  el.querySelector('.minhas-aulas')?.addEventListener('click', (e) => {
    const g = e.target.closest('[data-grupo]');
    if (g) {
      const mat = alunos.flatMap((a) => a.matriculas).find((x) => x.id === g.dataset.grupo);
      if (mat) marcarGrupo(mat);
      return;
    }
    const b = e.target.closest('[data-trancar]');
    if (!b) return;
    const mat = alunos.flatMap((a) => a.matriculas).find((x) => x.id === b.dataset.trancar);
    if (mat) pedirTrancamento(mat, () => renderPainelAluno(el));
  });
  el.querySelector('#comprovante').onclick = () => enviarComprovante(alunos);
  el.querySelector('#pagar-pix')?.addEventListener('click', () => pagarComPix({ total: aPagar.length ? total : null, vencimento }, () => enviarComprovante(alunos)));
  if (!grupoOferecido) { grupoOferecido = true; oferecerGrupos(alunos); }
}
let grupoOferecido = false; // a janela do grupo aparece uma vez por visita ao app (até o aluno entrar no grupo)

// ------------------------------------------------------------------ Pix
const ICONE_PIX = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M7.5 7.5 12 12l4.5-4.5M7.5 16.5 12 12l4.5 4.5"/></svg>';

/** Janela de pagamento: QR Code e Pix copia e cola com o valor já preenchido, e a chave como alternativa. */
function pagarComPix({ total, vencimento }, abrirComprovante) {
  const codigo = total ? codigoPix({ valor: total, descricao: 'Mensalidade CEVISA' }) : null;
  const m = abrirModal({
    titulo: 'Pagar com Pix',
    largura: 440,
    corpo: `
      ${total ? `<div class="pix-valor"><span>Valor a pagar</span><strong>${money(total)}</strong>${vencimento ? `<small>vencimento ${fmtDate(vencimento)}</small>` : ''}</div>` : ''}
      ${codigo ? `
        <button class="btn pix largo" type="button" data-copiar="codigo">${ICONE_PIX}Copiar código Pix (copia e cola)</button>
        <p class="pix-dica">O valor de <strong>${money(total)}</strong> já vem preenchido. É só colar no app do banco e confirmar.</p>
        <details class="pix-qr-caixa">
          <summary>Pagar lendo o QR Code (de outro celular ou do computador)</summary>
          <div class="pix-qr" data-qr><small class="sub">Gerando QR Code…</small></div>
        </details>
        <div class="pix-ou"><span>ou pague pela chave</span></div>` : ''}
      <div class="pix-chave">
        <span>Chave Pix (${esc(config.PIX_TIPO || 'chave')})</span>
        <strong>${esc(config.PIX_EXIBICAO || config.PIX_CHAVE)}</strong>
        <small>Spa Médico Adventista Cevisa</small>
      </div>
      <button class="btn ${codigo ? 'sec' : 'pix'} largo" type="button" data-copiar="chave">${codigo ? '' : ICONE_PIX}Copiar chave Pix</button>
      <ol class="pix-passos">
        ${codigo
          ? `<li>Toque em <strong>Copiar código Pix</strong>.</li>
             <li>No app do banco, escolha <strong>Pix → Pix copia e cola</strong>, cole e confira o nome do recebedor antes de confirmar.</li>`
          : `<li>Abra o app do seu banco e escolha <strong>Pix → Pagar com chave</strong>${config.PIX_TIPO ? ` (${esc(config.PIX_TIPO)})` : ''}.</li>
             <li>Cole a chave e informe o valor. Confira o nome do recebedor antes de confirmar.</li>`}
        <li>Depois de pagar, envie o comprovante por aqui. A recepção confere e dá baixa.</li>
      </ol>
      <div class="acoes">
        <button class="btn sec" type="button" data-fechar-pix>Fechar</button>
        <button class="btn" type="button" data-comprovante>Já paguei: enviar comprovante</button>
      </div>`,
  });

  if (codigo) {
    // o QR só é desenhado quando o aluno abre a seção
    m.el.querySelector('.pix-qr-caixa').addEventListener('toggle', async (e) => {
      const caixa = m.el.querySelector('[data-qr]');
      if (!e.target.open || caixa.dataset.ok) return;
      try { caixa.innerHTML = await qrSVG(codigo); caixa.dataset.ok = '1'; }
      catch { caixa.innerHTML = '<small class="sub">Não foi possível gerar o QR Code. Use o “copia e cola”.</small>'; }
    });
  }

  m.el.querySelectorAll('[data-copiar]').forEach((botao) => {
    botao.onclick = async () => {
      const ehCodigo = botao.dataset.copiar === 'codigo';
      const texto = ehCodigo ? codigo : config.PIX_CHAVE;
      try {
        await navigator.clipboard.writeText(texto);
      } catch {
        // navegador sem permissão de área de transferência: mostra o texto selecionado para copiar à mão
        const r = document.createRange();
        let alvo = m.el.querySelector('.pix-chave strong');
        if (ehCodigo) {
          alvo = m.el.querySelector('.pix-codigo') || botao.insertAdjacentElement('afterend', Object.assign(document.createElement('p'), { className: 'pix-codigo', textContent: codigo }));
        }
        r.selectNodeContents(alvo);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        toast('Toque e segure o texto selecionado para copiar.', 'erro');
        return;
      }
      m.el.querySelectorAll('[data-copiar]').forEach((b) => b.classList.remove('copiado'));
      botao.innerHTML = `${botao.classList.contains('pix') ? ICONE_PIX : ''}${ehCodigo ? 'Código copiado ✓' : 'Chave copiada ✓'}`;
      botao.classList.add('copiado');
      toast(ehCodigo ? 'Código Pix copiado! Agora cole em “Pix copia e cola” no app do banco.' : 'Chave Pix copiada! Agora cole no app do seu banco.');
    };
  });
  m.el.querySelector('[data-fechar-pix]').onclick = () => m.fechar();
  m.el.querySelector('[data-comprovante]').onclick = () => { m.fechar(); abrirComprovante(); };
}

// ------------------------------------------------------------------ comprovante
const ICONE_CLIPE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>';
const TIPOS_COMPROVANTE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
const COMPROVANTE_MAX = 10 * 1024 * 1024;

/** Aluno escolhe a foto/arquivo do comprovante; vai para o Storage, avisa a equipe no sino e é enviado por e-mail. */
function enviarComprovante(alunos) {
  const m = abrirModal({
    titulo: 'Enviar comprovante',
    largura: 460,
    corpo: `
      <form id="f-comp" novalidate>
        <p style="margin-top:0">Envie a foto ou o PDF do comprovante de pagamento. A recepção recebe na hora e confirma o pagamento.</p>
        ${alunos.length > 1 ? `
          <label class="campo"><span>Aluno</span>
            <select name="aluno">${alunos.map((al) => `<option value="${al.id}">${esc(quem(al))}</option>`).join('')}</select></label>`
          : `<input type="hidden" name="aluno" value="${alunos[0].id}">`}
        <label class="arquivo-caixa">
          <input type="file" name="arquivo" accept="image/*,application/pdf">
          <span class="arquivo-texto">${ICONE_CLIPE}<strong>Escolher foto ou arquivo</strong><small>JPG, PNG ou PDF · até 10 MB</small></span>
          <img class="arquivo-previa" alt="" hidden>
        </label>
        <label class="campo"><span>Observação (opcional)</span><textarea name="obs" maxlength="300" placeholder="Ex.: mensalidade de novembro, pago no Pix"></textarea></label>
        <div id="c-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit" disabled>Enviar</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-comp');
  const btn = form.querySelector('[type=submit]');
  const erro = (t) => { m.el.querySelector('#c-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();

  form.arquivo.addEventListener('change', () => {
    const f = form.arquivo.files[0];
    const previa = m.el.querySelector('.arquivo-previa');
    const texto = m.el.querySelector('.arquivo-texto strong');
    erro('');
    previa.hidden = true;
    btn.disabled = true;
    if (!f) { texto.textContent = 'Escolher foto ou arquivo'; return; }
    if (!TIPOS_COMPROVANTE[f.type]) { erro('Formato não aceito. Envie uma foto (JPG, PNG) ou um PDF.'); form.arquivo.value = ''; return; }
    if (f.size > COMPROVANTE_MAX) { erro('O arquivo passa de 10 MB. Escolha um menor.'); form.arquivo.value = ''; return; }
    texto.textContent = f.name;
    if (f.type.startsWith('image/') && !/hei[cf]/.test(f.type)) { previa.src = URL.createObjectURL(f); previa.hidden = false; }
    btn.disabled = false;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.arquivo.files[0];
    if (!f) return erro('Escolha o arquivo do comprovante.');
    await comBotao(btn, async () => {
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) throw new Error('Sua sessão expirou. Entre de novo.');
        const caminho = `${user.id}/${crypto.randomUUID()}.${TIPOS_COMPROVANTE[f.type]}`;
        ok(await sb.storage.from('comprovantes').upload(caminho, f, { contentType: f.type }));
        const id = ok(await sb.rpc('registrar_comprovante', {
          p_aluno: form.aluno.value, p_arquivo: caminho, p_nome: f.name, p_obs: form.obs.value,
        }));
        // O e-mail é um extra: se falhar, a equipe já foi avisada no app.
        try { await chamarFuncao('enviar-comprovante', { comprovante_id: id }); } catch (err) { console.warn('enviar-comprovante:', err.message); }
        m.fechar();
        toast('Comprovante enviado! A recepção vai conferir.');
      } catch (err) { erro(err.message); }
    });
  });
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
      ${m.turma ? `<p class="sub" style="margin:0">Turma: <strong>${esc(m.turma)}</strong></p>` : ''}
      ${varios || quem(aluno) !== aluno.nome ? `<p class="sub com-avatar" style="margin:0">${avatarHTML(aluno.foto, quem(aluno), 28)}<span>Aluno(a): <strong>${esc(quem(aluno))}</strong></span></p>` : ''}
      ${horariosHTML(m.horarios) || '<p class="sub" style="margin:0">Horários a confirmar com a recepção.</p>'}
      <dl class="linhas">
        ${espera ? '<div><dt>Situação</dt><dd>Aguardando vaga</dd></div>' : `
          <div><dt>Valor do plano</dt><dd>${m.preco === null ? 'a combinar' : moneyOuIsento(m.preco)}</dd></div>
          ${item?.valor !== null && item && Number(item.valor) !== Number(m.preco) ? `<div><dt>Próxima cobrança</dt><dd>${money(item.valor)}</dd></div>` : ''}
          <div><dt>Pago até</dt><dd>${pagoAte}</dd></div>
          ${m.trancados?.length ? `<div><dt>Meses trancados</dt><dd>${m.trancados.map(fmtMes).join(', ')}</dd></div>` : ''}`}
      </dl>
      ${m.grupo ? `<a class="btn whats pequeno grupo-btn" href="${esc(m.grupo)}" target="_blank" rel="noopener" data-grupo="${m.id}">${ICONE_WHATSAPP}Grupo da turma no WhatsApp</a>` : ''}
      ${trancamentoHTML(m)}
    </article>`;
}

// ------------------------------------------------------------------ grupo de WhatsApp da aula
/** Ao ser inscrito numa aula que tem grupo, o aluno recebe o link numa janela (até abrir o grupo). */
function oferecerGrupos(alunos) {
  const fila = alunos.flatMap((a) => a.matriculas.filter((m) => m.grupo && !m.grupo_visto).map((m) => ({ a, m })));
  const proximo = () => {
    const item = fila.shift();
    if (!item) return;
    const { a, m } = item;
    const j = abrirModal({
      titulo: 'Grupo do WhatsApp',
      largura: 420,
      corpo: `
        <div class="grupo-convite">
          <div class="grupo-icone">${ICONE_WHATSAPP}</div>
          <p><strong>${quem(a) !== a.nome || alunos.length > 1 ? `${esc(quem(a).split(' ')[0])} está inscrito(a)` : 'Você está inscrito(a)'} em ${esc(m.aula)}${m.turma ? ` — ${esc(m.turma)}` : ''}!</strong></p>
          <p class="sub">Entre no grupo do WhatsApp da aula para receber avisos, horários e novidades.</p>
          <a class="btn whats largo" href="${esc(m.grupo)}" target="_blank" rel="noopener" data-entrar>${ICONE_WHATSAPP}Entrar no grupo</a>
          <button class="link" type="button" data-depois style="margin-top:10px">Agora não</button>
        </div>`,
      aoFechar: () => setTimeout(proximo, 300),
    });
    j.el.querySelector('[data-entrar]').addEventListener('click', () => {
      marcarGrupo(m);
      setTimeout(() => j.fechar(), 150);
    });
    j.el.querySelector('[data-depois]').onclick = () => j.fechar();
  };
  proximo();
}

function marcarGrupo(m) {
  if (m.grupo_visto) return;
  m.grupo_visto = true;
  sb.rpc('marcar_grupo_visto', { p_matricula: m.id }).then(({ error }) => { if (error) console.warn('marcar_grupo_visto:', error.message); });
}

// ------------------------------------------------------------------ trancamento (aluno pede, equipe aprova)
const proximoMes = () => primeiroDiaMes(hojeISO(), 1);
const nomeMes = (iso) => fmtMesLongo(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));

/** Situação do trancamento no cartão da aula + botão (só semestral/anual ativos). */
function trancamentoHTML(m) {
  if (m.status !== 'ativa' || m.plano === 'mensal') return '';
  const prox = proximoMes();
  const ped = m.tranc_pedido;
  if (ped?.status === 'pendente') {
    return `<div class="aviso info tranc-aviso">Trancamento de <strong>${nomeMes(ped.mes)}</strong> solicitado. Aguardando a recepção aprovar.</div>`;
  }
  if ((m.trancados || []).includes(prox)) {
    return `<div class="aviso ok tranc-aviso">${nomeMes(prox)} está trancado. O mês foi acrescentado ao final do seu plano.</div>`;
  }
  return `${ped?.status === 'recusado' && ped.mes === prox ? `<div class="aviso alerta tranc-aviso">O trancamento de ${nomeMes(prox)} não foi aprovado. Em caso de dúvida, fale com a recepção.</div>` : ''}
    <button class="btn sec pequeno tranc-btn" type="button" data-trancar="${m.id}">Trancar mês</button>`;
}

/** Janela: o aluno pede para trancar o PRÓXIMO mês (em qualquer dia). Vale só depois da aprovação. */
function pedirTrancamento(m, aoConcluir) {
  const prox = proximoMes();
  // + 1 mês, como no banco (31/01 -> 28/02)
  const novoFim = (() => {
    const [y, mm, d] = m.data_fim.split('-').map(Number);
    const ultimo = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
    const x = new Date(Date.UTC(y, mm, Math.min(d, ultimo)));
    return x.toISOString().slice(0, 10);
  })();
  const dentro = prox < m.data_fim;
  const j = abrirModal({
    titulo: `Trancar mês — ${m.aula}`,
    largura: 460,
    corpo: dentro ? `
      <div class="tranc-opcao">
        <span>Trancar o próximo mês</span>
        <strong>${nomeMes(prox)}</strong>
      </div>
      <ul class="tranc-regras">
        <li>Você não frequenta as aulas em <strong>${nomeMes(prox)}</strong>.</li>
        <li>O mês é acrescentado ao final do plano: ele passa a valer até <strong>${fmtDate(novoFim)}</strong>.</li>
        <li>O pedido vai para a recepção e <strong>só vale depois de aprovado</strong>. Você acompanha a resposta aqui no app.</li>
      </ul>
      <div id="tr-erro"></div>
      <div class="acoes">
        <button class="btn sec" type="button" data-fechar-tr>Cancelar</button>
        <button class="btn" type="button" data-pedir-tr>Pedir trancamento</button>
      </div>` : `
      <p>O próximo mês (${nomeMes(prox)}) fica fora do período já pago do seu plano (até ${fmtDate(m.data_fim)}), então não dá para trancá-lo. Fale com a recepção.</p>
      <div class="acoes"><button class="btn" type="button" data-fechar-tr>Entendi</button></div>`,
  });
  j.el.querySelector('[data-fechar-tr]').onclick = () => j.fechar();
  const pedir = j.el.querySelector('[data-pedir-tr]');
  if (pedir) {
    pedir.onclick = () => comBotao(pedir, async () => {
      try {
        ok(await sb.rpc('solicitar_trancamento', { p_matricula: m.id }));
        j.fechar();
        toast('Pedido enviado! A recepção vai analisar o trancamento.');
        aoConcluir();
      } catch (err) {
        j.el.querySelector('#tr-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
      }
    });
  }
}

// ------------------------------------------------------------------ pedido de inscrição
/**
 * Aluno escolhe a turma e o plano e pede inscrição; o gestor/admin recebe uma notificação e conclui a inscrição.
 * turmas: turmas_publicas desta aula. Turmas sem vaga ficam cinza e não podem ser escolhidas,
 * a não ser que TODAS estejam cheias (aí o pedido é para a lista de espera).
 */
export function abrirPedidoInscricao(aula, turmas, alunos, aoConcluir) {
  const livres = alunos.filter((al) =>
    !al.matriculas.some((m) => m.aula_id === aula.id) && !al.solicitacoes?.some((s) => s.aula_id === aula.id));
  // preço conforme o vínculo de quem vai fazer a aula (funcionário/prestador confirmado; dependente = preço normal)
  const vinculoDe = (id) => livres.find((al) => al.id === id)?.vinculo || 'externo';
  const parcelas = { mensal: 1, semestral: 6, anual: 10 }; // máximo de parcelas
  const planosHTML = (alunoId, marcado) => {
    const v = vinculoDe(alunoId);
    const preco = (p) => precoVinculo(aula[`preco_${p}`], p, v);
    const escolhido = marcado || Object.keys(PLANOS).find((p) => preco(p) !== null) || 'mensal';
    return Object.keys(PLANOS).map((p) => {
      const valor = preco(p);
      const cheio = aula[`preco_${p}`];
      const diferente = valor !== null && cheio !== null && cheio !== undefined && valor !== Number(cheio);
      return `
            <label class="check plano-opcao">
              <input type="radio" name="plano" value="${p}" ${p === escolhido ? 'checked' : ''}>
              <span>${PLANOS[p]}${valor && parcelas[p] > 1 ? `<small>até ${parcelas[p]}x ${money(valor / parcelas[p])}</small>` : ''}${diferente ? `<small>preço de ${VINCULOS[v].nome.toLowerCase()} (normal ${money(cheio)})</small>` : ''}</span>
              <strong>${valor === null ? 'a consultar' : moneyOuIsento(valor)}</strong>
            </label>`;
    }).join('');
  };
  const fila = turmas.length ? turmas.every((t) => t.lotada) : !!aula.lotada;
  const primeiraLivre = turmas.find((t) => fila || !t.lotada);

  const m = abrirModal({
    titulo: `${fila ? 'Fila de espera' : 'Inscrição'} — ${aula.nome}`,
    largura: 480,
    corpo: `
      <form id="f-pedido" novalidate>
        ${fila ? `<div class="aviso alerta" style="margin-top:0">${turmas.length ? 'Todas as turmas' : 'Esta aula'} estão sem vagas no momento. Seu pedido entra na <strong>lista de espera</strong> e a recepção avisa quando abrir uma vaga.</div>` : ''}
        ${turmas.length ? `
          <fieldset style="border:0;padding:0;margin:0 0 14px">
            <legend style="font-weight:600;font-size:14px;margin-bottom:6px">Escolha a turma</legend>
            <div style="display:grid;gap:8px">${turmas.map((t) => {
              const bloqueada = t.lotada && !fila;
              return `
              <label class="check turma-opcao ${bloqueada ? 'bloqueada' : ''}">
                <input type="radio" name="turma" value="${t.id}" ${bloqueada ? 'disabled' : ''} ${t === primeiraLivre ? 'checked' : ''}>
                <span><strong>${esc(t.nome)}</strong>${t.lotada ? ` <em class="tag-lotada">${fila ? 'lista de espera' : 'sem vagas'}</em>` : ''}
                  ${t.horarios ? `<small>${esc(t.horarios).replace(/\n/g, ' · ')}</small>` : ''}
                  ${t.descricao ? `<small>${esc(t.descricao)}</small>` : ''}</span>
              </label>`;
            }).join('')}</div>
          </fieldset>`
          : horariosHTML(aula.horarios) ? `<div class="campo"><span style="font-weight:600;font-size:14px">Horários</span>${horariosHTML(aula.horarios)}</div>` : ''}
        ${livres.length > 1 ? `
          <label class="campo"><span>Aluno</span>
            <select name="aluno">${livres.map((al) => `<option value="${al.id}">${esc(quem(al))}</option>`).join('')}</select></label>`
          : `<input type="hidden" name="aluno" value="${livres[0]?.id || ''}">`}
        <fieldset style="border:0;padding:0;margin:0 0 14px">
          <legend style="font-weight:600;font-size:14px;margin-bottom:6px">Escolha o plano</legend>
          <div id="pd-planos" style="display:grid;gap:8px">${planosHTML(livres[0]?.id)}</div>
        </fieldset>
        <label class="campo"><span>Observação (opcional)</span><textarea name="obs" maxlength="300" placeholder="Ex.: tenho uma lesão no joelho"></textarea></label>
        ${fila ? '' : '<div class="aviso info">A recepção vai receber seu pedido e confirmar a inscrição. Depois disso, o valor aparece no seu painel.</div>'}
        <div id="pd-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn ${fila ? 'amarelo' : ''}" type="submit">${fila ? 'Entrar na fila de espera' : 'Enviar pedido'}</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-pedido');
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  // com mais de um aluno (responsável e dependente), o preço muda conforme quem vai fazer a aula
  form.querySelector('select[name=aluno]')?.addEventListener('change', (e) => {
    m.el.querySelector('#pd-planos').innerHTML = planosHTML(e.target.value, form.querySelector('[name=plano]:checked')?.value);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const turma = turmas.length ? form.querySelector('[name=turma]:checked')?.value : null;
    if (turmas.length && !turma) {
      m.el.querySelector('#pd-erro').innerHTML = '<div class="aviso erro">Escolha a turma.</div>';
      return;
    }
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.rpc('solicitar_inscricao', {
          p_aluno: form.aluno.value, p_aula: aula.id, p_plano: form.plano.value, p_obs: form.obs.value, p_turma: turma,
        }));
        m.fechar();
        toast(fila ? 'Pedido enviado! Você será avisado quando abrir uma vaga.' : 'Pedido enviado! A recepção vai confirmar sua inscrição.');
        aoConcluir();
      } catch (err) {
        m.el.querySelector('#pd-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
      }
    });
  });
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
