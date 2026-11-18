// Utilitários de interface: formatação, modal, toast, confirmação.

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
  const primeiro = corpoEl.querySelector('input:not([type=hidden]), select, textarea, button');
  primeiro?.focus();
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

export const carregando = (txt = 'Carregando…') => `<div class="carregando"><span class="spinner"></span>${esc(txt)}</div>`;
export const vazio = (txt) => `<p class="vazio">${esc(txt)}</p>`;
export const erroBox = (e) => `<div class="aviso erro">${esc(e.message || e)}</div>`;
