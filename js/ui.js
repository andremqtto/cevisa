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

// ---------------------------------------------------------------- WhatsApp e horários
/** Link wa.me para o número configurado em config.js, ou null se ainda não houver número. */
export function linkWhatsApp(mensagem = '') {
  const numero = String(config.WHATSAPP_NUMERO || '').replace(/\D/g, '');
  if (!numero) return null;
  return `https://wa.me/${numero}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`;
}

export const ICONE_WHATSAPP = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 8.6c0 3.3 3 6.4 6.4 6.4l1.1-1.6-2-1-1 .8c-1-.4-2.3-1.7-2.7-2.7l.8-1-1-2z" fill="currentColor" stroke-width="1"/></svg>`;

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
