// Utilitários de interface: formatação, modal, toast, confirmação.
import * as config from './config.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (v) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' sem mudança de fuso. */
export const fmtDate = (s) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const fmtMes = (s) => {
  if (!s) return '—';
  const [y, m] = String(s).slice(0, 10).split('-');
  return `${MESES[+m - 1]}/${y}`;
};
export const fmtMesLongo = (y, m) => `${MESES_LONGOS[m - 1]} de ${y}`;

export const PLANOS = { mensal: 'Mensal', semestral: 'Semestral', anual: 'Anual' };
export const planoLabel = (p) => PLANOS[p] || p;

export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Diferença em dias entre duas datas ISO (b - a). */
export const diasEntre = (a, b) => {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
};

/** Soma meses a uma data ISO, usando o 1º dia do mês. */
export const primeiroDiaMes = (iso, deslocamento = 0) => {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deslocamento, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

// ---------------------------------------------------------------- toast
export function toast(msg, tipo = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('sai'), tipo === 'erro' ? 6000 : 3500);
  setTimeout(() => t.remove(), tipo === 'erro' ? 6400 : 3900);
}

// ---------------------------------------------------------------- modal
let pilhaModais = [];

export function abrirModal({ titulo, corpo, largura = 520, aoFechar }) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" style="max-width:${largura}px">
      <header class="modal-topo">
        <h2>${esc(titulo)}</h2>
        <button type="button" class="icone-btn" data-fechar aria-label="Fechar">×</button>
      </header>
      <div class="modal-corpo"></div>
    </div>`;
  const corpoEl = fundo.querySelector('.modal-corpo');
  if (typeof corpo === 'string') corpoEl.innerHTML = corpo;
  else if (corpo) corpoEl.appendChild(corpo);

  const api = {
    el: corpoEl,
    fechar() {
      if (!fundo.isConnected) return;
      fundo.remove();
      pilhaModais = pilhaModais.filter((m) => m !== api);
      if (!pilhaModais.length) document.body.classList.remove('sem-scroll');
      aoFechar?.();
    },
  };
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) api.fechar(); });
  fundo.querySelector('[data-fechar]').addEventListener('click', api.fechar);
  document.body.appendChild(fundo);
  document.body.classList.add('sem-scroll');
  pilhaModais.push(api);
  // No celular, focar um campo abre o teclado e cobre o modal; só foca automaticamente com mouse/teclado.
  if (matchMedia('(hover: hover)').matches) {
    const primeiro = corpoEl.querySelector('input:not([type=hidden]), select, textarea, button');
    primeiro?.focus();
  }
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pilhaModais.length) pilhaModais[pilhaModais.length - 1].fechar();
});

export function fecharTodosModais() {
  [...pilhaModais].forEach((m) => m.fechar());
}

export function confirmar(mensagem, { titulo = 'Confirmar', confirmarTexto = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    let resolvido = false;
    const fim = (v) => { if (!resolvido) { resolvido = true; resolve(v); } };
    const m = abrirModal({
      titulo,
      largura: 440,
      aoFechar: () => fim(false),
      corpo: `<p>${esc(mensagem)}</p>
        <div class="acoes">
          <button class="btn sec" data-nao type="button">Cancelar</button>
          <button class="btn ${perigo ? 'perigo' : ''}" data-sim type="button">${esc(confirmarTexto)}</button>
        </div>`,
    });
    m.el.querySelector('[data-nao]').onclick = () => m.fechar();
    m.el.querySelector('[data-sim]').onclick = () => { fim(true); m.fechar(); };
  });
}

/** Executa uma ação assíncrona num botão, evitando clique duplo e mostrando erros. */
export async function comBotao(btn, fn) {
  if (btn.disabled) return;
  const texto = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Aguarde…';
  try {
    return await fn();
  } catch (e) {
    toast(e.message || 'Algo deu errado.', 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = texto;
  }
}

// ---------------------------------------------------------------- tabelas responsivas
// Copia o texto de cada <th> para data-label das células, para o CSS exibir as linhas como cartões no celular.
function rotularTabelas() {
  document.querySelectorAll('.tabela-wrap table').forEach((tabela) => {
    const titulos = [...tabela.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    tabela.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
      let col = 0;
      [...tr.cells].forEach((td) => {
        if (td.colSpan === 1 && !td.hasAttribute('data-label')) td.dataset.label = titulos[col] ?? '';
        col += td.colSpan;
      });
    });
  });
}
let rotularAgendado = false;
new MutationObserver(() => {
  if (rotularAgendado) return;
  rotularAgendado = true;
  requestAnimationFrame(() => { rotularAgendado = false; rotularTabelas(); });
}).observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------- teclado do celular
// Mantém o campo em foco visível acima do teclado virtual, em todo o app.
// --vv-altura / --vv-topo descrevem a área realmente visível (usadas pelo CSS dos modais).
const vv = window.visualViewport;
const docEl = document.documentElement;
const ehToque = () => matchMedia('(hover: none)').matches;
const ehCampoTexto = (el) =>
  !!el?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([type=range]), textarea');

let tMostrar;
function mostrarCampo(el) {
  clearTimeout(tMostrar);
  tMostrar = setTimeout(() => {
    if (document.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 150);
}

function medirViewport() {
  if (!vv) return;
  docEl.style.setProperty('--vv-altura', `${Math.round(vv.height)}px`);
  docEl.style.setProperty('--vv-topo', `${Math.round(vv.offsetTop)}px`);
}
if (vv) {
  medirViewport();
  vv.addEventListener('scroll', medirViewport);
  vv.addEventListener('resize', () => {
    medirViewport();
    // o teclado terminou de abrir/fechar: reposiciona o campo ativo
    if (ehToque() && ehCampoTexto(document.activeElement)) mostrarCampo(document.activeElement);
  });
}
document.addEventListener('focusin', (e) => {
  if (!ehToque() || !ehCampoTexto(e.target)) return;
  docEl.classList.add('digitando');
  mostrarCampo(e.target);
});
// Tira o modo "digitando" quando nenhum campo de texto está em foco. Precisa ser checado em vários
// momentos: se o campo some da tela (ex.: o modal de login fecha), o navegador não avisa com focusout.
export function conferirDigitando() {
  if (!ehCampoTexto(document.activeElement) || !document.activeElement.isConnected) docEl.classList.remove('digitando');
}
document.addEventListener('focusout', () => setTimeout(conferirDigitando, 120));
['pointerdown', 'hashchange'].forEach((ev) => window.addEventListener(ev, () => setTimeout(conferirDigitando, 150)));
new MutationObserver(() => {
  if (docEl.classList.contains('digitando')) conferirDigitando();
}).observe(document.body, { childList: true });
if (vv) vv.addEventListener('resize', () => setTimeout(conferirDigitando, 150));

// ---------------------------------------------------------------- credenciais temporárias
/** Mostra e-mail + senha temporária com opções de copiar, compartilhar e enviar por WhatsApp. */
export function mostrarCredenciais({ titulo = 'Acesso criado', email, senha, quem = 'aluno' }) {
  const site = config.APP_URL || `${location.origin}${location.pathname}`;
  const proximo = quem === 'aluno'
    ? 'No primeiro acesso você vai criar sua própria senha e completar seu cadastro.'
    : 'No primeiro acesso você vai criar sua própria senha.';
  const mensagem = `Olá! Seu acesso ao app CEVISA:\n\nSite: ${site}\nE-mail: ${email}\nSenha temporária: ${senha}\n\n${proximo}`;
  const m = abrirModal({
    titulo,
    largura: 460,
    corpo: `
      <p style="margin-top:0">Passe estes dados para ${quem === 'aluno' ? 'o aluno' : 'a pessoa'}. <strong>A senha não será mostrada de novo</strong>
        (se perder, é possível gerar outra).</p>
      <dl class="credenciais">
        <div><dt>Site</dt><dd>${esc(site)}</dd></div>
        <div><dt>E-mail</dt><dd>${esc(email)}</dd></div>
        <div><dt>Senha temporária</dt><dd class="senha">${esc(senha)}</dd></div>
      </dl>
      <div class="acoes" style="justify-content:center">
        <button class="btn sec" type="button" data-copiar>Copiar mensagem</button>
        <a class="btn sec" href="https://wa.me/?text=${encodeURIComponent(mensagem)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        ${typeof navigator.share === 'function' ? '<button class="btn sec" type="button" data-compartilhar>Compartilhar</button>' : ''}
        <button class="btn" type="button" data-ok>Pronto</button>
      </div>`,
  });
  m.el.querySelector('[data-copiar]').onclick = async () => {
    try { await navigator.clipboard.writeText(mensagem); toast('Mensagem copiada.'); } catch { toast('Não foi possível copiar. Anote os dados acima.', 'erro'); }
  };
  m.el.querySelector('[data-compartilhar]')?.addEventListener('click', async () => {
    try { await navigator.share({ title: 'Acesso ao app CEVISA', text: mensagem }); } catch { /* cancelado */ }
  });
  m.el.querySelector('[data-ok]').onclick = () => m.fechar();
  return m;
}

// ---------------------------------------------------------------- WhatsApp e horários
/** Link wa.me para o número configurado em config.js, ou null se ainda não houver número. */
export function linkWhatsApp(mensagem = '') {
  const numero = String(config.WHATSAPP_NUMERO || '').replace(/\D/g, '');
  if (!numero) return null;
  return `https://wa.me/${numero}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`;
}

// ---------------------------------------------------------------- responsável x quem faz as aulas
// A ficha é do RESPONSÁVEL (login e pagamento). Quem faz as aulas é ele mesmo ou um dependente.
export const nomeParticipante = (a) =>
  (a && a.participante_proprio === false && (a.participante_nome || '').trim()) ? a.participante_nome : a?.nome;

/** Campos "Quem vai fazer as aulas?" para formulários de cadastro. */
export function camposParticipante(a = {}) {
  const proprio = a.participante_proprio !== false;
  return `
    <fieldset class="participante">
      <legend>Quem vai fazer as aulas?</legend>
      <label class="check"><input type="checkbox" name="part_proprio" ${proprio ? 'checked' : ''}> O próprio responsável (titular deste cadastro)</label>
      <div class="participante-campos grade2" ${proprio ? 'hidden' : ''}>
        <label class="campo"><span>Nome do dependente *</span><input type="text" name="part_nome" maxlength="120" value="${esc(a.participante_nome)}"></label>
        <label class="campo"><span>Data de nascimento</span><input type="date" name="part_nasc" max="${hojeISO()}" value="${esc(a.participante_nascimento)}"></label>
      </div>
    </fieldset>`;
}

/** Liga a caixa "o próprio responsável" aos campos do dependente. */
export function ligarParticipante(form) {
  const caixa = form.querySelector('[name=part_proprio]');
  const campos = form.querySelector('.participante-campos');
  caixa.addEventListener('change', () => {
    campos.hidden = caixa.checked;
    if (!caixa.checked) form.querySelector('[name=part_nome]').focus();
  });
}

/** Lê os campos; devolve { proprio, nome, nascimento } ou lança erro se faltar o nome do dependente. */
export function lerParticipante(form) {
  const proprio = form.querySelector('[name=part_proprio]').checked;
  const nome = form.querySelector('[name=part_nome]').value.trim();
  const nascimento = form.querySelector('[name=part_nasc]').value || null;
  if (!proprio && !nome) throw new Error('Informe o nome do dependente, ou marque a caixa “O próprio responsável”.');
  if (nascimento && nascimento > hojeISO()) throw new Error('Data de nascimento de quem vai fazer as aulas inválida.');
  return { proprio, nome: proprio ? null : nome, nascimento: proprio ? null : nascimento };
}

// ---------------------------------------------------------------- vínculo (externo, funcionário, prestador)
// Mesma regra do banco (_preco_aluno): funcionário não paga; prestador paga R$ 100,00 no plano mensal;
// externo paga o preço normal. Aulas de um DEPENDENTE têm sempre o preço normal.
export const PRESTADOR_MENSAL = 100;
export const VINCULOS = {
  externo: { nome: 'Externo', regra: 'Preço normal das aulas.' },
  funcionario: { nome: 'Funcionário', regra: 'Aulas sem custo.' },
  prestador: { nome: 'Prestador', regra: `Plano mensal de ${money(PRESTADOR_MENSAL)} em todas as aulas.` },
};

/** Vínculo que vale para o preço (dependente = externo). Aceita a ficha completa ou o item do painel_aluno. */
export const vinculoPreco = (a) => (!a || a.participante_proprio === false ? 'externo' : (a.vinculo || 'externo'));

/** Preço de um plano para o vínculo; null = plano sem preço definido. */
export function precoVinculo(valor, plano, vinculo) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (vinculo === 'funcionario') return 0;
  if (vinculo === 'prestador' && plano === 'mensal') return PRESTADOR_MENSAL;
  return Number(valor);
}

/** Valor para exibir: "Sem custo" quando é zero. */
export const moneyOuIsento = (v) => (Number(v) === 0 ? 'Sem custo' : money(v));

/** Opções "Externo / Funcionário / Prestador" para o cadastro (rádio obrigatório). */
export function camposVinculo(atual = null, { gestor = false } = {}) {
  return `
    <fieldset class="vinculo">
      <legend>${gestor ? 'Vínculo com o Cevisa' : 'Qual é o seu vínculo com o Cevisa? *'}</legend>
      ${Object.entries(VINCULOS).map(([v, d]) => `
        <label class="check vinculo-opcao"><input type="radio" name="vinculo" value="${v}" ${atual === v ? 'checked' : ''}>
          <span><strong>${d.nome}</strong><small>${d.regra}</small></span></label>`).join('')}
      <p class="vinculo-obs">${gestor ? '' : 'Funcionário e prestador: a recepção confirma e o preço passa a valer. '}Se as aulas forem para um <strong>dependente</strong>, valem os preços normais.</p>
    </fieldset>`;
}

/**
 * Link do WhatsApp com a mensagem de cobrança pronta (vai para o telefone do responsável).
 * p: cobrança { valor, vencimento, plano, aula }; aluno: ficha { nome, telefone, participante_* }.
 * Devolve null se o aluno não tiver telefone.
 */
export function linkCobrancaWhatsApp(p, aluno) {
  if (!aluno?.telefone) return null;
  const hoje = hojeISO();
  const primeiro = (aluno.nome || '').trim().split(/\s+/)[0] || '';
  const quem = nomeParticipante(aluno);
  const dias = p.vencimento < hoje ? diasEntre(p.vencimento, hoje) : 0;
  const quando = dias ? `venceu em ${fmtDate(p.vencimento)} (há ${dias} dia${dias > 1 ? 's' : ''})`
    : p.vencimento === hoje ? 'vence hoje' : `vence em ${fmtDate(p.vencimento)}`;
  const linhas = [
    `Olá, ${primeiro}! Tudo bem? Aqui é da recepção do Spa Médico Adventista Cevisa.`,
    '',
    `A mensalidade de *${p.aula || 'sua aula'}*${quem && quem !== aluno.nome ? ` (${quem.split(' ')[0]})` : ''}, no valor de *${money(p.valor)}*, ${quando}.`,
    '',
    config.APP_URL ? `Você pode pagar pelo app, no botão *Pagar com Pix*: ${config.APP_URL}` : '',
    config.PIX_CHAVE ? `Ou pela chave Pix (${config.PIX_TIPO || 'chave'}): ${config.PIX_EXIBICAO || config.PIX_CHAVE}` : '',
    '',
    'Depois, é só enviar o comprovante pelo app. Se já pagou, por favor desconsidere esta mensagem. Obrigado!',
  ].filter((l, i, arr) => l !== '' || (arr[i - 1] !== '' && i > 0));
  return linkWhatsAppPara(aluno.telefone, linhas.join('\n').trim());
}

/** Link wa.me para o telefone de um aluno (DDD + número; sem DDI assume Brasil), ou null se inválido. */
export function linkWhatsAppPara(telefone, mensagem = '') {
  let n = String(telefone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  if (n.length < 12) return null;
  return `https://wa.me/${n}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`;
}

export const ICONE_WHATSAPP =`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 8.6c0 3.3 3 6.4 6.4 6.4l1.1-1.6-2-1-1 .8c-1-.4-2.3-1.7-2.7-2.7l.8-1-1-2z" fill="currentColor" stroke-width="1"/></svg>`;

/** Lista de horários (texto livre, um por linha) em HTML. */
export function horariosHTML(texto) {
  const linhas = String(texto || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return '';
  const relogio = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  return `<ul class="horarios" aria-label="Horários">${linhas.map((l) => `<li>${relogio}<span>${esc(l)}</span></li>`).join('')}</ul>`;
}

export const carregando = (txt = 'Carregando…') => `<div class="carregando"><span class="spinner"></span>${esc(txt)}</div>`;
export const vazio = (txt) => `<p class="vazio">${esc(txt)}</p>`;
export const erroBox = (e) => `<div class="aviso erro">${esc(e.message || e)}</div>`;

// ------------------------------------------------------------------ endereço (preenchido pelo CEP)
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/**
 * Campos de endereço: começa pelo CEP, que preenche rua, bairro, cidade e estado.
 * Sem CEP, a pessoa preenche tudo à mão. det = endereco_detalhe já salvo (para editar).
 */
export function camposEndereco(det = {}, { obrigatorio = true, atual = '' } = {}) {
  const d = det || {};
  const ast = obrigatorio ? ' *' : '';
  return `
    <fieldset class="endereco">
      <legend>Endereço${obrigatorio ? ' completo *' : ''}</legend>
      ${!d.logradouro && atual ? `<p class="sub" style="margin:0 0 10px">Endereço atual: ${esc(atual)}. Preencha abaixo para atualizar.</p>` : ''}
      <label class="campo"><span>CEP</span>
        <input type="text" name="end_cep" inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="00000-000" value="${esc(d.cep || '')}">
        <small data-cep-status>Digite o CEP para preencher o endereço automaticamente. Não sabe? Preencha os campos abaixo.</small></label>
      <label class="campo"><span>Rua / avenida${ast}</span>
        <input type="text" name="end_logradouro" maxlength="150" autocomplete="address-line1" value="${esc(d.logradouro || '')}"></label>
      <div class="grade2">
        <label class="campo"><span>Número${ast}</span>
          <input type="text" name="end_numero" maxlength="20" placeholder="Ex.: 123 ou s/n" value="${esc(d.numero || '')}"></label>
        <label class="campo"><span>Complemento</span>
          <input type="text" name="end_complemento" maxlength="80" autocomplete="address-line2" placeholder="Apto, bloco, casa…" value="${esc(d.complemento || '')}"></label>
      </div>
      <label class="campo"><span>Bairro${ast}</span>
        <input type="text" name="end_bairro" maxlength="80" value="${esc(d.bairro || '')}"></label>
      <div class="grade2">
        <label class="campo"><span>Cidade${ast}</span>
          <input type="text" name="end_cidade" maxlength="80" autocomplete="address-level2" value="${esc(d.cidade || '')}"></label>
        <label class="campo"><span>Estado (UF)${ast}</span>
          <select name="end_uf" autocomplete="address-level1"><option value="">Selecione</option>${UFS.map((u) => `<option ${u === d.uf ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      </div>
    </fieldset>`;
}

/** Máscara do CEP e busca automática do endereço (ViaCEP). */
export function ligarEndereco(form) {
  const cep = form.end_cep;
  if (!cep) return;
  const status = form.querySelector('[data-cep-status]');
  const msg = (t, cls = '') => { status.textContent = t; status.className = cls; };
  let ultimo = '';
  cep.addEventListener('input', async () => {
    const n = cep.value.replace(/\D/g, '').slice(0, 8);
    cep.value = n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
    if (n.length !== 8 || n === ultimo) return;
    ultimo = n;
    msg('Buscando endereço…');
    try {
      const r = await fetch(`https://viacep.com.br/ws/${n}/json/`);
      const j = await r.json();
      if (!r.ok || j.erro) throw new Error('nao achou');
      if (cep.value.replace(/\D/g, '') !== n) return; // a pessoa já mudou o CEP
      const por = (campo, valor) => { if (valor) form[campo].value = valor; };
      por('end_logradouro', j.logradouro);
      por('end_bairro', j.bairro);
      por('end_cidade', j.localidade);
      por('end_uf', j.uf);
      msg(j.logradouro ? 'Endereço encontrado. Confira e informe o número.' : 'CEP da cidade inteira: preencha a rua e o bairro.', 'ok');
      (j.logradouro ? form.end_numero : form.end_logradouro).focus();
    } catch {
      ultimo = '';
      msg('CEP não encontrado. Confira o número ou preencha o endereço abaixo.', 'erro');
    }
  });
}

/**
 * Lê o endereço do formulário. Devolve null se tudo estiver vazio (e não for obrigatório).
 * Lança erro com a mensagem para a pessoa se faltar algum campo.
 */
export function lerEndereco(form, { obrigatorio = true } = {}) {
  const v = (n) => (form[n]?.value || '').trim();
  const d = {
    cep: v('end_cep').replace(/\D/g, ''), logradouro: v('end_logradouro'), numero: v('end_numero'),
    complemento: v('end_complemento'), bairro: v('end_bairro'), cidade: v('end_cidade'), uf: v('end_uf'),
  };
  if (!obrigatorio && !Object.values(d).some(Boolean)) return null;
  if (d.cep && d.cep.length !== 8) throw new Error('CEP inválido: use 8 números (ou deixe em branco).');
  const falta = [['logradouro', 'rua'], ['numero', 'número'], ['bairro', 'bairro'], ['cidade', 'cidade'], ['uf', 'estado']]
    .filter(([k]) => !d[k]).map(([, n]) => n);
  if (falta.length) throw new Error(`Preencha o endereço completo: falta ${falta.join(', ').replace(/, ([^,]*)$/, ' e $1')}.`);
  return d;
}

/** Parâmetros da função definir_endereco. */
export const argsEndereco = (alunoId, d) => ({
  p_aluno: alunoId, p_cep: d.cep || null, p_logradouro: d.logradouro, p_numero: d.numero,
  p_complemento: d.complemento || null, p_bairro: d.bairro, p_cidade: d.cidade, p_uf: d.uf,
});

// ------------------------------------------------------------------ dependente: sexo e parentesco
export const PARENTESCOS = ['Filho(a)', 'Enteado(a)', 'Neto(a)', 'Sobrinho(a)', 'Irmão(ã)', 'Cônjuge', 'Pai / Mãe', 'Avô / Avó', 'Tutelado(a)', 'Outro'];
export const SEXOS = { F: 'Feminino', M: 'Masculino' };

/** Campos de sexo e grau de parentesco do dependente (modal "Adicionar dependente"). */
export function camposDependente() {
  return `
    <div class="grade2">
      <label class="campo"><span>Sexo *</span>
        <select name="sexo" required><option value="">Selecione…</option>
          ${Object.entries(SEXOS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      <label class="campo"><span>Parentesco (o dependente é seu…) *</span>
        <select name="parentesco" required><option value="">Selecione…</option>
          ${PARENTESCOS.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
    </div>`;
}

/** Lê sexo e parentesco; lança erro se faltar algum. */
export function lerDependente(form) {
  const sexo = form.querySelector('[name=sexo]').value;
  const parentesco = form.querySelector('[name=parentesco]').value;
  if (!sexo) throw new Error('Informe o sexo do dependente.');
  if (!parentesco) throw new Error('Informe o grau de parentesco com o dependente.');
  return { sexo, parentesco };
}

// ------------------------------------------------------------------ idade mínima das aulas
/** Idade em anos completos na data ref (YYYY-MM-DD); null sem data de nascimento. */
export function idadeAnos(nasc, ref = hojeISO()) {
  if (!nasc) return null;
  const [y, m, d] = nasc.slice(0, 10).split('-').map(Number);
  const [Y, M, D] = ref.split('-').map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}
/** Nascimento de quem faz as aulas: do painel (campo nascimento) ou da ficha (dependente ou titular). */
export const nascimentoDe = (al) => (al.nascimento !== undefined ? al.nascimento
  : al.participante_proprio === false && (al.participante_nome || '').trim() ? al.participante_nascimento : al.data_nascimento);
/** true se a pessoa ainda não tem a idade mínima da aula (sem data de nascimento: não barra). */
export function abaixoIdade(aula, al) {
  if (!aula?.idade_minima) return false;
  const i = idadeAnos(nascimentoDe(al));
  return i !== null && i < aula.idade_minima;
}
