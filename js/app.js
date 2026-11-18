// CEVISA — ponto de entrada: autenticação, cabeçalho e rotas.
import { sb, ok, configurado } from './supabase.js';
import { esc, abrirModal, fecharTodosModais, toast, comBotao, carregando, erroBox } from './ui.js';
import { renderHome } from './home.js';
import { iniciarNotificacoes, pararNotificacoes } from './notificacoes.js';

const estado = { isGestor: false, email: null };
let renderizadoComoGestor = null; // evita redesenhar à toa quando o Supabase reemite SIGNED_IN
const raiz = document.getElementById('app');

const ROTAS_GESTOR = [
  { rota: '', rotulo: 'Aulas' },
  { rota: 'alunos', rotulo: 'Alunos' },
  { rota: 'cobrancas', rotulo: 'Cobranças' },
  { rota: 'relatorios', rotulo: 'Relatórios' },
];

function navegar(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

// ------------------------------------------------------------------ cabeçalho
function desenharTopo(rotaAtual) {
  const nav = estado.isGestor
    ? ROTAS_GESTOR.map((r) => `<a href="#/${r.rota}" class="${r.rota === rotaAtual ? 'atual' : ''}">${r.rotulo}</a>`).join('')
    : '';
  document.getElementById('topo').innerHTML = `
    <div class="topo-in">
      <a class="logo" href="#/" aria-label="CEVISA — Spa Médico Adventista, página inicial"><img src="assets/logo.png" alt="Spa Médico Adventista Cevisa"></a>
      <nav class="nav" aria-label="Principal">${nav}</nav>
      <div class="topo-acoes">
        ${estado.isGestor
          ? '<span id="notif-host"></span><button class="btn sec pequeno" id="btn-sair" type="button">Sair</button>'
          : '<button class="btn" id="btn-entrar" type="button">Entrar</button>'}
      </div>
    </div>`;
  document.getElementById('btn-entrar')?.addEventListener('click', abrirLogin);
  document.getElementById('btn-sair')?.addEventListener('click', sair);
  if (estado.isGestor) iniciarNotificacoes(document.getElementById('notif-host'), { navegar });
}

// ------------------------------------------------------------------ login
export function abrirLogin() {
  if (document.querySelector('#f-login')) return;
  const m = abrirModal({
    titulo: 'Entrar',
    largura: 420,
    corpo: `
      <img class="login-logo" src="assets/logo.png" alt="Spa Médico Adventista Cevisa">
      <p class="sub" style="text-align:center;margin:0 0 16px">Acesso exclusivo para gestores.</p>
      <form id="f-login" novalidate>
        <label class="campo"><span>E-mail</span><input type="email" name="email" autocomplete="username" required></label>
        <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
        <div id="login-erro"></div>
        <div class="acoes"><button class="btn" type="submit" style="width:100%">Entrar</button></div>
      </form>`,
  });
  const form = m.el.querySelector('#f-login');
  const erro = (t) => { m.el.querySelector('#login-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const senha = form.senha.value;
    if (!email || !senha) return erro('Informe e-mail e senha.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        ok(await sb.auth.signInWithPassword({ email, password: senha }));
        const gestor = await verificarGestor();
        if (!gestor) {
          await sb.auth.signOut();
          return erro('Este usuário não tem permissão de gestor.');
        }
        m.fechar();
        await rotear();
        toast('Bem-vindo(a)!');
      } catch (err) {
        erro(err.message);
      }
    });
  });
}

async function verificarGestor() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { estado.isGestor = false; estado.email = null; return false; }
  const { data, error } = await sb.from('gestores').select('user_id').eq('user_id', session.user.id).maybeSingle();
  estado.isGestor = !error && !!data;
  estado.email = session.user.email;
  return estado.isGestor;
}

async function sair() {
  await sb.auth.signOut();
}

// ------------------------------------------------------------------ rotas
let versaoRota = 0;

async function rotear() {
  const minha = ++versaoRota;
  renderizadoComoGestor = estado.isGestor;
  fecharTodosModais();
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const rota = partes[0] || '';

  if (rota && !estado.isGestor) {
    history.replaceState(null, '', '#/');
    desenharTopo('');
    await renderHome(raiz, { isGestor: false, abrirLogin });
    abrirLogin();
    return;
  }
  desenharTopo(rota === 'alunos' ? 'alunos' : rota);
  window.scrollTo(0, 0);
  raiz.innerHTML = carregando();
  try {
    if (!rota) await renderHome(raiz, { isGestor: estado.isGestor, abrirLogin });
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
    } else {
      navegar('#/');
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
  await verificarGestor();
  // Importante: não chamar o Supabase direto dentro do callback (pode travar); adiamos com setTimeout.
  sb.auth.onAuthStateChange((evento) => {
    if (evento !== 'SIGNED_IN' && evento !== 'SIGNED_OUT') return;
    setTimeout(async () => {
      await verificarGestor();
      if (evento === 'SIGNED_OUT') { pararNotificacoes(); history.replaceState(null, '', '#/'); }
      if (estado.isGestor !== renderizadoComoGestor) rotear();
    }, 0);
  });
  window.addEventListener('hashchange', rotear);
  rotear();
}

iniciar();
