// Sino de notificações do gestor (vencimentos de plano e vagas liberadas).
import { sb, ok } from './supabase.js';
import { esc, toast, fmtDate } from './ui.js';

let timer = null;

export function iniciarNotificacoes(host, { navegar }) {
  pararNotificacoes();
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
          <button class="notif ${n.lida ? '' : 'nova'} ${n.tipo}" type="button" data-id="${n.id}" data-aluno="${n.aluno_id || ''}">
            <strong>${n.tipo === 'vencido' ? 'Plano vencido' : n.tipo === 'vaga_liberada' ? 'Vaga liberada' : 'Vence em breve'}</strong>
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
        await atualizarContagem();
        await abrir();
      } catch (err) { toast(err.message, 'erro'); }
      return;
    }
    const item = e.target.closest('.notif');
    if (!item) return;
    try { ok(await sb.from('notificacoes').update({ lida: true }).eq('id', item.dataset.id)); } catch { /* segue */ }
    fechar();
    atualizarContagem();
    if (item.dataset.aluno) navegar(`#/alunos/${item.dataset.aluno}`);
  };
  document.addEventListener('click', fecharFora);
  function fecharFora(e) { if (!host.contains(e.target)) fechar(); }
  host._limpar = () => document.removeEventListener('click', fecharFora);

  gerar();
  timer = setInterval(gerar, 5 * 60 * 1000);
}

export function pararNotificacoes() {
  if (timer) clearInterval(timer);
  timer = null;
  document.querySelectorAll('#notif-host').forEach((h) => h._limpar?.());
}
