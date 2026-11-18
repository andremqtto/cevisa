// CEVISA — ponto de entrada: autenticação, cabeçalho e rotas.
import { sb, ok, configurado } from './supabase.js';
import { esc, abrirModal, fecharTodosModais, toast, comBotao, carregando, erroBox, linkWhatsApp, ICONE_WHATSAPP } from './ui.js';
import { renderHome } from './home.js';
import { iniciarNotificacoes, pararNotificacoes } from './notificacoes.js';

// papel: 'gestor' | 'aluno' | null (visitante)
const estado = { papel: null, email: null };
let renderizadoComo; // evita redesenhar à toa quando o Supabase reemite SIGNED_IN
const raiz = document.getElementById('app');

const ROTAS = {
  gestor: [
    { rota: '', rotulo: 'Aulas' },
    { rota: 'alunos', rotulo: 'Alunos' },
    { rota: 'cobrancas', rotulo: 'Cobranças' },
    { rota: 'relatorios', rotulo: 'Relatórios' },
  ],
  aluno: [
    { rota: '', rotulo: 'Meu painel' },
    { rota: 'aulas', rotulo: 'Aulas' },
  ],
};
const ROTAS_GESTOR = ['alunos', 'cobrancas', 'relatorios'];

function navegar(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

// ------------------------------------------------------------------ cabeçalho
function desenharTopo(rotaAtual) {
  const nav = (ROTAS[estado.papel] || [])
    .map((r) => `<a href="#/${r.rota}" class="${r.rota === rotaAtual ? 'atual' : ''}">${r.rotulo}</a>`).join('');
  let acoes = '<button class="btn" id="btn-entrar" type="button">Entrar</button>';
  if (estado.papel === 'gestor') acoes = '<span id="notif-host"></span><button class="btn sec pequeno" id="btn-sair" type="button">Sair</button>';
  if (estado.papel === 'aluno') acoes = '<button class="btn sec pequeno" id="btn-sair" type="button">Sair</button>';
  document.getElementById('topo').innerHTML = `
    <div class="topo-in">
      <a class="logo" href="#/" aria-label="CEVISA — Spa Médico Adventista, página inicial"><img src="assets/logo.png" alt="Spa Médico Adventista Cevisa"></a>
      <nav class="nav" aria-label="Principal">${nav}</nav>
      <div class="topo-acoes">${acoes}</div>
    </div>`;
  document.getElementById('btn-entrar')?.addEventListener('click', () => abrirLogin());
  document.getElementById('btn-sair')?.addEventListener('click', sair);
  if (estado.papel === 'gestor') iniciarNotificacoes(document.getElementById('notif-host'), { navegar });
}

// ------------------------------------------------------------------ balão do WhatsApp (só visitantes)
function atualizarWhatsApp() {
  let balao = document.getElementById('whats');
  if (estado.papel) { balao?.remove(); return; }
  if (balao) return;
  const link = linkWhatsApp('Olá! Gostaria de informações sobre as aulas do Spa Médico Adventista Cevisa.');
  balao = document.createElement('a');
  balao.id = 'whats';
  balao.className = 'whats-flutuante';
  balao.href = link || '#';
  balao.target = '_blank';
  balao.rel = 'noopener';
  balao.setAttribute('aria-label', 'Fale conosco pelo WhatsApp');
  balao.innerHTML = `${ICONE_WHATSAPP}<span>Fale conosco</span>`;
  if (!link) {
    balao.addEventListener('click', (e) => {
      e.preventDefault();
      toast('O número do WhatsApp ainda não foi configurado (js/config.js).', 'erro');
    });
  }
  document.body.appendChild(balao);
}

// ------------------------------------------------------------------ login e primeiro acesso
export function abrirLogin(modo = 'entrar') {
  if (document.querySelector('#f-login')) return;
  const m = abrirModal({ titulo: 'Entrar', largura: 420, corpo: '' });
  const tituloEl = m.el.closest('.modal').querySelector('.modal-topo h2');

  function desenhar(modoAtual, aviso = '') {
    const primeiro = modoAtual === 'primeiro';
    tituloEl.textContent = primeiro ? 'Primeiro acesso' : 'Entrar';
    m.el.innerHTML = `
      <img class="login-logo" src="assets/logo.png" alt="Spa Médico Adventista Cevisa">
      <p class="sub" style="text-align:center;margin:0 0 16px">${primeiro
        ? 'Crie sua senha usando o mesmo e-mail que você informou na recepção.'
        : 'Acesso para alunos e gestores.'}</p>
      ${aviso}
      <form id="f-login" novalidate>
        <label class="campo"><span>E-mail</span><input type="email" name="email" inputmode="email" autocapitalize="none" autocomplete="${primeiro ? 'email' : 'username'}" required></label>
        <label class="campo"><span>${primeiro ? 'Crie uma senha' : 'Senha'}</span><input type="password" name="senha" autocomplete="${primeiro ? 'new-password' : 'current-password'}" required>${primeiro ? '<small>Mínimo de 6 caracteres.</small>' : ''}</label>
        ${primeiro ? '<label class="campo"><span>Repita a senha</span><input type="password" name="senha2" autocomplete="new-password" required></label>' : ''}
        <div id="login-erro"></div>
        <div class="acoes"><button class="btn" type="submit" style="width:100%">${primeiro ? 'Criar acesso' : 'Entrar'}</button></div>
      </form>
      <p class="login-troca">${primeiro
        ? 'Já tem senha? <button type="button" class="link" data-modo="entrar">Entrar</button>'
        : 'Aluno sem senha ainda? <button type="button" class="link" data-modo="primeiro">Primeiro acesso</button>'}</p>`;
    const form = m.el.querySelector('#f-login');
    const erro = (t) => { m.el.querySelector('#login-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
    m.el.querySelector('[data-modo]').onclick = (e) => desenhar(e.currentTarget.dataset.modo);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      (primeiro ? criarAcesso : entrar)(form, erro);
    });
  }

  async function entrar(form, erro) {
    const email = form.email.value.trim();
    const senha = form.senha.value;
    if (!email || !senha) return erro('Informe e-mail e senha.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.auth.signInWithPassword({ email, password: senha }));
        const papel = await verificarPapel();
        if (!papel) {
          await sb.auth.signOut();
          return erro('Não encontramos um cadastro de aluno com este e-mail. Confira o e-mail ou procure a recepção.');
        }
        m.fechar();
        await rotear();
        toast(papel === 'aluno' ? 'Bem-vindo(a) ao seu painel!' : 'Bem-vindo(a)!');
      } catch (err) {
        erro(/Email not confirmed/i.test(err.message)
          ? 'Seu e-mail ainda não foi confirmado. Abra o link que enviamos para o seu e-mail e tente de novo.'
          : err.message);
      }
    });
  }

  async function criarAcesso(form, erro) {
    const email = form.email.value.trim();
    const senha = form.senha.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return erro('Informe um e-mail válido.');
    if (senha.length < 6) return erro('A senha precisa ter pelo menos 6 caracteres.');
    if (senha !== form.senha2.value) return erro('As senhas não conferem.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        const r = ok(await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin + location.pathname } }));
        if (r.user && Array.isArray(r.user.identities) && r.user.identities.length === 0) {
          return erro('Este e-mail já tem acesso. Use “Entrar”.');
        }
        if (r.session) { // projeto sem confirmação de e-mail
          const papel = await verificarPapel();
          if (!papel) { await sb.auth.signOut(); return erro('Não encontramos um cadastro de aluno com este e-mail. Procure a recepção.'); }
          m.fechar();
          await rotear();
          return;
        }
        desenhar('entrar', `<div class="aviso info">Quase lá! Enviamos um link de confirmação para <strong>${esc(email)}</strong>.
          Abra seu e-mail, toque no link e depois entre aqui com seu e-mail e senha.</div>`);
      } catch (err) {
        erro(/signups? not allowed|signup is disabled/i.test(err.message)
          ? 'O cadastro de alunos ainda não está liberado. Fale com a recepção.'
          : err.message);
      }
    });
  }

  desenhar(modo);
}

/** Descobre se o usuário logado é gestor, aluno ou nenhum dos dois. */
async function verificarPapel() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { estado.papel = null; estado.email = null; return null; }
  estado.email = session.user.email;
  const { data: g, error } = await sb.from('gestores').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (!error && g) return (estado.papel = 'gestor');
  const { data: qtd, error: e2 } = await sb.rpc('vincular_aluno');
  if (e2) console.warn('vincular_aluno:', e2.message);
  return (estado.papel = !e2 && qtd > 0 ? 'aluno' : null);
}

async function sair() {
  await sb.auth.signOut();
}

// ------------------------------------------------------------------ rotas
let versaoRota = 0;

async function rotear() {
  const minha = ++versaoRota;
  renderizadoComo = estado.papel;
  fecharTodosModais();
  atualizarWhatsApp();
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let rota = partes[0] || '';

  // Visitante: só a tela de aulas. Rotas de gestor pedem login.
  if (!estado.papel) {
    if (rota) history.replaceState(null, '', '#/');
    desenharTopo('');
    window.scrollTo(0, 0);
    await renderHome(raiz, { isGestor: false });
    if (ROTAS_GESTOR.includes(rota)) abrirLogin();
    return;
  }

  const permitidas = estado.papel === 'gestor' ? ['', ...ROTAS_GESTOR] : ['', 'aulas'];
  if (!permitidas.includes(rota)) { history.replaceState(null, '', '#/'); rota = ''; }

  desenharTopo(rota);
  window.scrollTo(0, 0);
  raiz.innerHTML = carregando();
  try {
    if (estado.papel === 'aluno') {
      if (rota === 'aulas') return await renderHome(raiz, { isGestor: false, logado: true });
      const { renderPainelAluno } = await import('./aluno.js');
      if (minha !== versaoRota) return;
      return await renderPainelAluno(raiz);
    }
    if (!rota) await renderHome(raiz, { isGestor: true });
    else if (rota === 'alunos') {
      const { renderAlunos, renderFicha } = await import('./alunos.js');
      if (minha !== versaoRota) return;
      partes[1] ? await renderFicha(raiz, partes[1], { navegar }) : await renderAlunos(raiz, { navegar });
    } else if (rota === 'cobrancas') {
      const { renderCobrancas } = await import('./financeiro.js');
      if (minha !== versaoRota) return;
      await renderCobrancas(raiz, { navegar });
    } else if (rota === 'relatorios') {
      const { renderRelatorios } = await import('./relatorios.js');
      if (minha !== versaoRota) return;
      await renderRelatorios(raiz, { navegar });
    }
  } catch (e) {
    raiz.innerHTML = erroBox(e);
  }
}

// ------------------------------------------------------------------ início
async function iniciar() {
  if (!configurado) {
    document.getElementById('topo').innerHTML = '';
    raiz.innerHTML = `
      <div class="setup">
        <img src="assets/logo.png" alt="Spa Médico Adventista Cevisa" style="height:60px;margin-bottom:12px">
        <h1>Falta conectar ao Supabase</h1>
        <p>Abra o arquivo <code>js/config.js</code> e preencha <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> com os dados do seu projeto
        (Supabase → Project Settings → API). Depois recarregue esta página.</p>
        <p>Veja o passo a passo completo no <code>README.md</code>.</p>
      </div>`;
    return;
  }
  // Link de confirmação de e-mail expirado/inválido volta com #error=...
  const linkComErro = /error_description=/.test(location.hash);

  const { data: { session } } = await sb.auth.getSession();
  await verificarPapel();
  if (session && !estado.papel) {
    // logou (ex.: pelo link de confirmação) mas não há cadastro de aluno com este e-mail
    await sb.auth.signOut();
    toast('Não encontramos um cadastro de aluno com este e-mail. Procure a recepção.', 'erro');
  }
  if (linkComErro) {
    history.replaceState(null, '', '#/');
    toast('Este link de confirmação expirou ou já foi usado. Tente entrar com seu e-mail e senha.', 'erro');
  }

  // Importante: não chamar o Supabase direto dentro do callback (pode travar); adiamos com setTimeout.
  sb.auth.onAuthStateChange((evento) => {
    if (evento !== 'SIGNED_IN' && evento !== 'SIGNED_OUT') return;
    setTimeout(async () => {
      await verificarPapel();
      if (evento === 'SIGNED_OUT') { pararNotificacoes(); history.replaceState(null, '', '#/'); }
      if (estado.papel !== renderizadoComo) rotear();
    }, 0);
  });
  window.addEventListener('hashchange', rotear);
  rotear();
}

iniciar();
