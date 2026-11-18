// Equipe: só o gestor principal vê esta aba.
//  - Admins: mesmas permissões do gestor, mas não mexem na equipe.
//  - Professores: veem os alunos das aulas atribuídas a eles, cadastram alunos novos e abrem o QR Code.
import { sb, ok, chamarCriarUsuario } from './supabase.js';
import { esc, fmtDate, abrirModal, toast, confirmar, comBotao, carregando, vazio, erroBox, mostrarCredenciais } from './ui.js';

export async function renderEquipe(el, { principal = true } = {}) {
  el.innerHTML = carregando('Carregando equipe…');
  let equipe, convites, eu, aulas = [], vinculos = [];
  try {
    eu = (await sb.auth.getUser()).data.user?.id;
    equipe = ok(await sb.from('gestores').select('user_id,nome,papel,email,created_at').order('created_at'));
    convites = ok(await sb.from('convites_admin').select('email,nome,created_at').order('created_at'));
    aulas = ok(await sb.from('aulas').select('id,nome,ativa').order('ordem').order('nome'));
    const rv = await sb.from('professor_aulas').select('user_id,aula_id');
    vinculos = rv.error ? [] : rv.data;
  } catch (e) { el.innerHTML = erroBox(e); return; }

  const admins = equipe.filter((g) => g.papel === 'admin');
  const professores = equipe.filter((g) => g.papel === 'professor');
  const gestores = equipe.filter((g) => g.papel !== 'admin' && g.papel !== 'professor');
  const aulasDe = (userId) => vinculos.filter((v) => v.user_id === userId).map((v) => v.aula_id);
  const nomeAula = (id) => aulas.find((a) => a.id === id)?.nome;
  const recarregar = () => renderEquipe(el, { principal });

  const membro = (g, extra = '') => `
    <li>
      <div><strong>${esc(g.nome || g.email)}</strong><small>${esc(g.email || '')} · desde ${fmtDate((g.created_at || '').slice(0, 10))}</small>${extra}</div>
      <div class="acoes-linha">
        ${g.papel === 'professor' ? `<button class="btn sec pequeno" type="button" data-aulas="${g.user_id}">Aulas</button>` : ''}
        ${principal || g.papel === 'professor' ? `<button class="btn sec perigo pequeno" type="button" data-remover="${g.user_id}">Remover</button>` : ''}
      </div>
    </li>`;

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Equipe</h1><p class="sub">${principal
        ? 'Admins fazem tudo o que o gestor faz e podem cadastrar professores. Professores veem os alunos das aulas deles e cadastram alunos novos.'
        : 'Aqui você cadastra os professores e escolhe as aulas de cada um. Professores veem os alunos das aulas deles e cadastram alunos novos.'}</p></div>
      <button class="btn" type="button" id="novo-membro">＋ ${principal ? 'Adicionar à equipe' : 'Adicionar professor'}</button>
    </div>

    <section class="card">
      <h2>Gestor</h2>
      <ul class="lista-equipe">${gestores.map((g) => `
        <li><div><strong>${esc(g.nome || g.email || 'Gestor')}</strong>${g.user_id === eu ? ' <span class="badge">você</span>' : ''}
          ${g.email ? `<small>${esc(g.email)}</small>` : ''}</div></li>`).join('')}</ul>
    </section>

    <section class="card">
      <h2>Professores <span class="badge">${professores.length}</span></h2>
      ${professores.length ? `<ul class="lista-equipe">${professores.map((g) => {
        const ids = aulasDe(g.user_id);
        return membro(g, `<div class="chips" style="margin-top:6px">${ids.length ? ids.map((id) => `<span class="chip">${esc(nomeAula(id))}</span>`).join('') : '<span class="badge alerta">sem aulas atribuídas</span>'}</div>`);
      }).join('')}</ul>` : vazio('Nenhum professor ainda. Clique em “Adicionar à equipe”.')}
    </section>

    <section class="card">
      <h2>Admins <span class="badge">${admins.length}</span></h2>
      ${admins.length ? `<ul class="lista-equipe">${admins.map((g) => membro(g)).join('')}</ul>` : vazio('Nenhum admin ainda.')}
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

  el.querySelector('#novo-membro').onclick = () => adicionarMembro(aulas, recarregar, principal);
  el.onclick = async (e) => {
    const au = e.target.closest('[data-aulas]');
    if (au) {
      const g = professores.find((x) => x.user_id === au.dataset.aulas);
      return editarAulasProfessor(g, aulas, aulasDe(g.user_id), recarregar);
    }
    const rem = e.target.closest('[data-remover]');
    if (rem) {
      const g = equipe.find((x) => x.user_id === rem.dataset.remover);
      const tipo = g.papel === 'professor' ? 'professor' : 'admin';
      if (!(await confirmar(`Remover ${g.nome || g.email} da equipe (${tipo})? A pessoa perde o acesso na hora.`, { titulo: `Remover ${tipo}`, confirmarTexto: 'Remover', perigo: true }))) return;
      await comBotao(rem, async () => {
        ok(await sb.rpc('remover_admin', { p_user: g.user_id }));
        toast(tipo === 'professor' ? 'Professor removido.' : 'Admin removido.');
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

const checkAulas = (aulas, marcadas = []) => `
  <div class="checks-aulas">${aulas.map((a) => `
    <label class="check"><input type="checkbox" name="aula" value="${a.id}" ${marcadas.includes(a.id) ? 'checked' : ''}> ${esc(a.nome)}${a.ativa ? '' : ' <span class="badge cinza">oculta</span>'}</label>`).join('')
  || '<p class="sub">Nenhuma aula cadastrada ainda.</p>'}</div>`;

// principal = false (admin): só pode adicionar professores.
function adicionarMembro(aulas, aoConcluir, principal = true) {
  const m = abrirModal({
    titulo: principal ? 'Adicionar à equipe' : 'Adicionar professor',
    largura: 480,
    corpo: `
      <form id="f-membro" novalidate>
        <fieldset class="papel-escolha" ${principal ? '' : 'hidden'}>
          <legend>Tipo de acesso</legend>
          <label class="check plano-opcao"><input type="radio" name="papel" value="professor" checked>
            <span>Professor<small>Vê os alunos das aulas dele, cadastra alunos e abre o QR Code. Não vê valores.</small></span></label>
          <label class="check plano-opcao"><input type="radio" name="papel" value="admin">
            <span>Admin<small>Mesmas permissões do gestor, menos mexer na equipe.</small></span></label>
        </fieldset>
        <label class="campo"><span>Nome</span><input type="text" name="nome" maxlength="120" autocomplete="off"></label>
        <label class="campo"><span>E-mail *</span><input type="email" name="email" maxlength="120" inputmode="email" autocapitalize="none" autocomplete="off" required>
          <small>A pessoa entra no app com este e-mail.</small></label>
        <div class="campo" id="campo-aulas"><span>Aulas (modalidades) do professor</span>${checkAulas(aulas)}</div>
        <div class="aviso info">O app vai gerar uma <strong>senha temporária</strong> para você passar à pessoa. No primeiro acesso ela cria a própria senha.</div>
        <div id="ad-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Adicionar</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-membro');
  const erro = (t) => { m.el.querySelector('#ad-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  const papel = () => form.querySelector('[name=papel]:checked').value;
  form.querySelectorAll('[name=papel]').forEach((r) => r.addEventListener('change', () => {
    m.el.querySelector('#campo-aulas').hidden = papel() !== 'professor';
  }));
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return erro('Informe um e-mail válido.');
    const aulasEscolhidas = [...form.querySelectorAll('[name=aula]:checked')].map((c) => c.value);
    if (papel() === 'professor' && !aulasEscolhidas.length) return erro('Escolha pelo menos uma aula do professor.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const r = await chamarCriarUsuario({ acao: 'criar_admin', email, nome: form.nome.value, papel: papel(), aulas: aulasEscolhidas });
        const quem = papel() === 'professor' ? 'professor' : 'admin';
        m.fechar();
        aoConcluir();
        if (r.senha) mostrarCredenciais({ titulo: quem === 'professor' ? 'Professor criado' : 'Admin criado', email: r.email, senha: r.senha, quem });
        else toast(`${quem === 'professor' ? 'Professor' : 'Admin'} adicionado. Já pode entrar com a senha que usa hoje.`);
      } catch (err) { erro(err.message); }
    });
  });
}

function editarAulasProfessor(prof, aulas, marcadas, aoConcluir) {
  const m = abrirModal({
    titulo: `Aulas de ${prof.nome || prof.email}`,
    largura: 440,
    corpo: `
      <form id="f-aulas-prof" novalidate>
        <p class="sub" style="margin-top:0">O professor vê os alunos (e a lista de espera) destas aulas.</p>
        ${checkAulas(aulas, marcadas)}
        <div id="ap-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-cancelar>Cancelar</button>
          <button class="btn" type="submit">Salvar</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-aulas-prof');
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.rpc('definir_aulas_professor', {
          p_user: prof.user_id, p_aulas: [...form.querySelectorAll('[name=aula]:checked')].map((c) => c.value),
        }));
        m.fechar();
        toast('Aulas do professor atualizadas.');
        aoConcluir();
      } catch (err) { m.el.querySelector('#ap-erro').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`; }
    });
  });
}
