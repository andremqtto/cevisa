// Admins: só o gestor principal vê esta aba. Admins têm as mesmas permissões do gestor,
// mas não podem adicionar nem remover outros admins.
import { sb, ok } from './supabase.js';
import { esc, fmtDate, abrirModal, toast, confirmar, comBotao, carregando, vazio, erroBox } from './ui.js';

export async function renderEquipe(el) {
  el.innerHTML = carregando('Carregando equipe…');
  let equipe, convites, eu;
  try {
    eu = (await sb.auth.getUser()).data.user?.id;
    equipe = ok(await sb.from('gestores').select('user_id,nome,papel,email,created_at').order('created_at'));
    convites = ok(await sb.from('convites_admin').select('email,nome,created_at').order('created_at'));
  } catch (e) { el.innerHTML = erroBox(e); return; }

  const admins = equipe.filter((g) => g.papel === 'admin');
  const gestores = equipe.filter((g) => g.papel !== 'admin');
  const recarregar = () => renderEquipe(el);

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Admins</h1><p class="sub">Admins podem fazer tudo o que o gestor faz, menos adicionar ou remover admins.</p></div>
      <button class="btn" type="button" id="novo-admin">＋ Adicionar admin</button>
    </div>

    <section class="card">
      <h2>Gestor</h2>
      <ul class="lista-equipe">${gestores.map((g) => `
        <li><div><strong>${esc(g.nome || g.email || 'Gestor')}</strong>${g.user_id === eu ? ' <span class="badge">você</span>' : ''}
          ${g.email ? `<small>${esc(g.email)}</small>` : ''}</div></li>`).join('')}</ul>
    </section>

    <section class="card">
      <h2>Admins <span class="badge">${admins.length}</span></h2>
      ${admins.length ? `<ul class="lista-equipe">${admins.map((g) => `
        <li>
          <div><strong>${esc(g.nome || g.email)}</strong><small>${esc(g.email || '')} · desde ${fmtDate((g.created_at || '').slice(0, 10))}</small></div>
          <button class="btn sec perigo pequeno" type="button" data-remover="${g.user_id}">Remover</button>
        </li>`).join('')}</ul>` : vazio('Nenhum admin ainda. Clique em “Adicionar admin”.')}
    </section>

    ${convites.length ? `
    <section class="card">
      <h2>Aguardando primeiro acesso <span class="badge alerta">${convites.length}</span></h2>
      <p class="sub" style="margin:-6px 0 12px">Estas pessoas viram admins assim que criarem a senha em <strong>Entrar → Primeiro acesso</strong> e confirmarem o e-mail.</p>
      <ul class="lista-equipe">${convites.map((c) => `
        <li>
          <div><strong>${esc(c.nome || c.email)}</strong><small>${esc(c.email)} · convidado em ${fmtDate((c.created_at || '').slice(0, 10))}</small></div>
          <button class="btn sec pequeno" type="button" data-cancelar="${esc(c.email)}">Cancelar convite</button>
        </li>`).join('')}</ul>
    </section>` : ''}`;

  el.querySelector('#novo-admin').onclick = () => adicionarAdmin(recarregar);
  el.onclick = async (e) => {
    const rem = e.target.closest('[data-remover]');
    if (rem) {
      const g = admins.find((x) => x.user_id === rem.dataset.remover);
      if (!(await confirmar(`Remover ${g.nome || g.email} dos admins? A pessoa perde o acesso ao painel na hora.`, { titulo: 'Remover admin', confirmarTexto: 'Remover', perigo: true }))) return;
      await comBotao(rem, async () => {
        ok(await sb.rpc('remover_admin', { p_user: g.user_id }));
        toast('Admin removido.');
        recarregar();
      });
      return;
    }
    const canc = e.target.closest('[data-cancelar]');
    if (canc) {
      await comBotao(canc, async () => {
        ok(await sb.rpc('cancelar_convite_admin', { p_email: canc.dataset.cancelar }));
        toast('Convite cancelado.');
        recarregar();
      });
    }
  };
}

function adicionarAdmin(aoConcluir) {
  const m = abrirModal({
    titulo: 'Adicionar admin',
    largura: 460,
    corpo: `
      <form id="f-admin" novalidate>
        <label class="campo"><span>Nome</span><input type="text" name="nome" maxlength="120" autocomplete="off"></label>
        <label class="campo"><span>E-mail *</span><input type="email" name="email" maxlength="120" inputmode="email" autocapitalize="none" autocomplete="off" required>
          <small>A pessoa entra no app com este e-mail.</small></label>
        <div class="aviso info">Se a pessoa ainda não tem senha, peça para ela abrir o app, tocar em <strong>Entrar → Primeiro acesso</strong>
          e criar a senha com este e-mail. Depois de confirmar o e-mail, ela já entra como admin.</div>
        <div id="ad-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Adicionar</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-admin');
  const erro = (t) => { m.el.querySelector('#ad-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return erro('Informe um e-mail válido.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const r = ok(await sb.rpc('adicionar_admin', { p_email: email, p_nome: form.nome.value }));
        m.fechar();
        toast(r === 'ativo' ? 'Admin adicionado. O acesso já está liberado.' : 'Convite criado. A pessoa vira admin ao fazer o primeiro acesso.');
        aoConcluir();
      } catch (err) { erro(err.message); }
    });
  });
}
