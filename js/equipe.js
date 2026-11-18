// Admins: só o gestor principal vê esta aba. Admins têm as mesmas permissões do gestor,
// mas não podem adicionar nem remover outros admins.
import { sb, ok, chamarCriarUsuario } from './supabase.js';
import { esc, fmtDate, abrirModal, toast, confirmar, comBotao, carregando, vazio, erroBox, mostrarCredenciais } from './ui.js';

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
      <p class="sub" style="margin:-6px 0 12px">Convites do método antigo. Para liberar o acesso agora, cancele o convite e adicione o admin de novo (o app gera uma senha temporária).</p>
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
        <div class="aviso info">O app vai gerar uma <strong>senha temporária</strong> para você passar à pessoa. No primeiro acesso ela cria a própria senha.
          Se o e-mail já tiver conta no app, ela vira admin na hora e continua com a senha que já usa.</div>
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
        const r = await chamarCriarUsuario({ acao: 'criar_admin', email, nome: form.nome.value });
        m.fechar();
        aoConcluir();
        if (r.senha) mostrarCredenciais({ titulo: 'Admin criado', email: r.email, senha: r.senha, quem: 'admin' });
        else toast('Admin adicionado. Ele já pode entrar com a senha que usa hoje.');
      } catch (err) { erro(err.message); }
    });
  });
}
