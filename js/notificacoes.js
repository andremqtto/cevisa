// Sino de notificações do gestor (vencimentos, vagas liberadas e pagamentos informados)
// e banners de "aluno informou pagamento" no topo da tela.
import { sb, ok } from './supabase.js';
import { esc, toast, fmtDate } from './ui.js';

let timer = null;
let timerBanners = null;
let canal = null;

const ROTULOS = {
  vencido: 'Plano vencido',
  vaga_liberada: 'Vaga liberada',
  vence_em_breve: 'Vence em breve',
  pagamento_informado: 'Pagamento informado',
  inscricao_solicitada: 'Pedido de inscrição',
  comprovante_enviado: 'Comprovante enviado',
  vinculo_declarado: 'Vínculo a confirmar',
  trancamento_solicitado: 'Pedido de trancamento',
  parq_alerta: 'PAR-Q: avaliação médica',
};
// Tipos que também aparecem como banner no topo da tela (o aluno está esperando uma resposta).
const TIPOS_BANNER = ['pagamento_informado', 'comprovante_enviado'];

export function iniciarNotificacoes(host, { navegar }) {
  pararNotificacoes({ manterBanners: true });
  host.innerHTML = `
    <div class="sino">
      <button class="icone-btn sino-btn" type="button" aria-label="Notificações" aria-expanded="false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span class="contagem" hidden>0</span>
      </button>
      <div class="painel-notif" hidden></div>
    </div>`;
  const btn = host.querySelector('.sino-btn');
  const badge = host.querySelector('.contagem');
  const painel = host.querySelector('.painel-notif');

  async function atualizarContagem() {
    try {
      const { count, error } = await sb.from('notificacoes').select('id', { count: 'exact', head: true }).eq('lida', false);
      if (error) throw error;
      badge.textContent = count > 99 ? '99+' : count;
      badge.hidden = !count;
    } catch { /* silencioso: tenta de novo no próximo ciclo */ }
  }

  async function marcarLida(id) {
    try { ok(await sb.from('notificacoes').update({ lida: true }).eq('id', id)); } catch { /* segue */ }
    atualizarContagem();
  }

  // ---------------------------------------------------------------- banners
  function caixaBanners() {
    let box = document.getElementById('banners');
    if (!box) {
      box = document.createElement('div');
      box.id = 'banners';
      box.setAttribute('aria-live', 'assertive');
      document.body.appendChild(box);
    }
    return box;
  }

  function mostrarBanner(n) {
    if (document.querySelector(`.banner[data-id="${n.id}"]`)) return;
    const el = document.createElement('div');
    el.className = 'banner';
    el.dataset.id = n.id;
    el.dataset.aluno = n.aluno_id || '';
    el.innerHTML = `
      <button class="banner-corpo" type="button">
        <strong>${n.tipo === 'comprovante_enviado' ? 'Comprovante enviado pelo aluno' : 'Pagamento informado pelo aluno'}</strong>
        <span>${esc(n.mensagem)}</span>
        <small>Toque para confirmar o pagamento</small>
      </button>
      <button class="icone-btn banner-fechar" type="button" aria-label="Dispensar aviso">×</button>`;
    // O banner só some quando o pagamento é confirmado (ou dispensado no ×).
    el.querySelector('.banner-corpo').onclick = () => {
      if (n.aluno_id) abrirConfirmacao(n);
      else { el.remove(); marcarLida(n.id); }
    };
    el.querySelector('.banner-fechar').onclick = () => { el.remove(); marcarLida(n.id); };
    caixaBanners().appendChild(el);
  }

  // Janela "Confirmar pagamento" (dá baixa nas mensalidades do aluno de uma vez).
  async function abrirConfirmacao(n) {
    const { confirmarPagamentoInformado } = await import('./financeiro.js');
    confirmarPagamentoInformado({
      alunoId: n.aluno_id,
      mensagem: n.mensagem,
      navegar,
      aoConcluir: () => {
        // a confirmação marca como lidos os avisos de pagamento/comprovante deste aluno
        document.querySelectorAll(`#banners .banner[data-aluno="${n.aluno_id}"]`).forEach((b) => b.remove());
        atualizarContagem();
        navegar(location.hash || '#/'); // atualiza a tela atual (cobranças, ficha…)
      },
    });
  }

  async function buscarBanners() {
    try {
      const itens = ok(await sb.from('notificacoes').select('id,tipo,aluno_id,mensagem,created_at')
        .in('tipo', TIPOS_BANNER).eq('lida', false).order('created_at').limit(5));
      itens.forEach(mostrarBanner);
    } catch { /* tenta de novo no próximo ciclo */ }
  }

  // ---------------------------------------------------------------- painel do sino
  async function gerar() {
    try { ok(await sb.rpc('atualizar_pendencias')); } catch (e) { console.warn('atualizar_pendencias:', e.message); }
    await atualizarContagem();
  }

  async function abrir() {
    painel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    painel.innerHTML = '<p class="vazio">Carregando…</p>';
    try {
      const itens = ok(await sb.from('notificacoes').select('*').order('lida').order('created_at', { ascending: false }).limit(40));
      painel.innerHTML = `
        <header><h3>Notificações</h3>
          <button class="btn sec pequeno" type="button" data-todas>Marcar todas como lidas</button></header>
        ${itens.length ? itens.map((n) => `
          <button class="notif ${n.lida ? '' : 'nova'} ${n.tipo}" type="button" data-id="${n.id}" data-aluno="${n.aluno_id || ''}" data-msg="${esc(n.mensagem)}">
            <strong>${ROTULOS[n.tipo] || 'Aviso'}</strong>
            <div>${esc(n.mensagem)}</div>
            <small>${fmtDate(n.created_at)}</small>
          </button>`).join('') : '<p class="vazio">Nenhuma notificação por enquanto.</p>'}`;
    } catch (e) {
      painel.innerHTML = `<p class="vazio">${esc(e.message)}</p>`;
    }
  }

  function fechar() {
    painel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.onclick = () => (painel.hidden ? abrir() : fechar());
  painel.onclick = async (e) => {
    if (e.target.closest('[data-todas]')) {
      try {
        ok(await sb.from('notificacoes').update({ lida: true }).eq('lida', false));
        document.querySelectorAll('#banners .banner').forEach((b) => b.remove());
        await atualizarContagem();
        await abrir();
      } catch (err) { toast(err.message, 'erro'); }
      return;
    }
    const item = e.target.closest('.notif');
    if (!item) return;
    // pagamento informado / comprovante: abre a confirmação direto (mesmo já lido)
    if (TIPOS_BANNER.some((t) => item.classList.contains(t)) && item.dataset.aluno) {
      fechar();
      return abrirConfirmacao({ aluno_id: item.dataset.aluno, mensagem: item.dataset.msg || '' });
    }
    document.querySelector(`.banner[data-id="${item.dataset.id}"]`)?.remove();
    fechar();
    marcarLida(item.dataset.id);
    if (item.dataset.aluno) navegar(`#/alunos/${item.dataset.aluno}`);
  };
  document.addEventListener('click', fecharFora);
  function fecharFora(e) { if (!host.contains(e.target)) fechar(); }
  host._limpar = () => document.removeEventListener('click', fecharFora);

  // Tempo real: o banner aparece na hora em que o aluno avisa (com consulta periódica de reserva).
  canal = sb.channel(`notificacoes-gestor-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificacoes' }, (p) => {
      atualizarContagem();
      if (TIPOS_BANNER.includes(p.new?.tipo)) mostrarBanner(p.new);
    })
    .subscribe();

  gerar();
  buscarBanners();
  timer = setInterval(gerar, 5 * 60 * 1000);
  timerBanners = setInterval(buscarBanners, 60 * 1000);
}

export function pararNotificacoes({ manterBanners = false } = {}) {
  if (timer) clearInterval(timer);
  if (timerBanners) clearInterval(timerBanners);
  timer = timerBanners = null;
  if (canal) { sb.removeChannel(canal); canal = null; }
  document.querySelectorAll('#notif-host').forEach((h) => h._limpar?.());
  if (!manterBanners) document.getElementById('banners')?.remove();
}
