// CEVISA — ponto de entrada: autenticação, cabeçalho e rotas.
import { sb, ok, configurado } from './supabase.js';
import { esc, abrirModal, fecharTodosModais, toast, comBotao, carregando, erroBox, linkWhatsApp, ICONE_WHATSAPP } from './ui.js';
import { renderHome } from './home.js';
import { iniciarNotificacoes, pararNotificacoes } from './notificacoes.js';

// papel: 'gestor' (gestor principal ou admin) | 'aluno' | null (visitante)
// principal: true só para o gestor principal (pode gerenciar admins)
// trocarSenha: entrou com senha temporária; cadastrosPendentes: fichas que o aluno ainda precisa completar
const estado = { papel: null, email: null, principal: false, erroVinculo: null, trocarSenha: false, cadastrosPendentes: [] };
let renderizadoComo; // evita redesenhar à toa quando o Supabase reemite SIGNED_IN
const raiz = document.getElementById('app');

const ROTAS = {
  gestor: [
    { rota: '', rotulo: 'Aulas' },
    { rota: 'alunos', rotulo: 'Alunos' },
    { rota: 'cobrancas', rotulo: 'Cobranças' },
    { rota: 'relatorios', rotulo: 'Relatórios' },
    { rota: 'equipe', rotulo: 'Admins', soPrincipal: true },
  ],
  aluno: [
    { rota: '', rotulo: 'Meu painel' },
    { rota: 'aulas', rotulo: 'Aulas' },
  ],
};
const ROTAS_GESTOR = ['alunos', 'cobrancas', 'relatorios', 'equipe'];

function navegar(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

// ------------------------------------------------------------------ cabeçalho
function desenharTopo(rotaAtual, { bloqueado = false } = {}) {
  // bloqueado: primeiro acesso pendente — só mostra o botão Sair
  if (bloqueado) {
    pararNotificacoes();
    document.getElementById('topo').innerHTML = `
      <div class="topo-in">
        <span class="logo"><img src="assets/logo.png" alt="Spa Médico Adventista Cevisa"></span>
        <nav class="nav" aria-label="Principal"></nav>
        <div class="topo-acoes"><button class="btn sec pequeno" id="btn-sair" type="button">Sair</button></div>
      </div>`;
    document.getElementById('btn-sair').addEventListener('click', sair);
    return;
  }
  const nav = (ROTAS[estado.papel] || [])
    .filter((r) => !r.soPrincipal || estado.principal)
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

// ------------------------------------------------------------------ balão do WhatsApp (visitantes e alunos)
function atualizarWhatsApp() {
  let balao = document.getElementById('whats');
  const quem = estado.papel === 'aluno' ? 'aluno' : estado.papel ? null : 'visitante';
  if (!quem) { balao?.remove(); return; }       // equipe não vê o balão
  if (balao?.dataset.quem === quem) return;
  balao?.remove();
  const link = linkWhatsApp(quem === 'aluno'
    ? 'Olá! Sou aluno(a) do Spa Médico Adventista Cevisa e gostaria de falar com a recepção.'
    : 'Olá! Gostaria de informações sobre as aulas do Spa Médico Adventista Cevisa.');
  balao = document.createElement('a');
  balao.id = 'whats';
  balao.dataset.quem = quem;
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

// ------------------------------------------------------------------ login
// Não há cadastro pelo próprio aluno: gestores/admins criam o acesso com senha temporária.
export function abrirLogin() {
  if (document.querySelector('#f-login')) return;
  const m = abrirModal({
    titulo: 'Entrar',
    largura: 420,
    corpo: `
      <img class="login-logo" src="assets/logo.png" alt="Spa Médico Adventista Cevisa">
      <p class="sub" style="text-align:center;margin:0 0 16px">Acesso para alunos e equipe.<br>Recebeu uma senha temporária? Use-a aqui.</p>
      <form id="f-login" novalidate>
        <label class="campo"><span>E-mail</span><input type="email" name="email" inputmode="email" autocapitalize="none" autocomplete="username" required></label>
        <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
        <div id="login-erro"></div>
        <div class="acoes"><button class="btn" type="submit" style="width:100%">Entrar</button></div>
      </form>
      <p class="login-troca">Ainda não tem acesso ou esqueceu a senha? Fale com a recepção.</p>`,
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
        const papel = await verificarPapel();
        if (!papel) {
          await sb.auth.signOut();
          return erro(msgSemCadastro());
        }
        m.fechar();
        await rotear();
        if (!primeiroAcessoPendente()) toast(papel === 'aluno' ? 'Bem-vindo(a) ao seu painel!' : 'Bem-vindo(a)!');
      } catch (err) {
        erro(err.message);
      }
    });
  });
}

/** Precisa trocar a senha temporária e/ou completar o cadastro antes de usar o app? */
const primeiroAcessoPendente = () => estado.trocarSenha || estado.cadastrosPendentes.length > 0;

const msgSemCadastro = () => estado.erroVinculo
  ? `Não foi possível verificar seu cadastro (erro no banco: ${estado.erroVinculo}). Avise a recepção.`
  : 'Esta conta não está ligada a nenhum aluno. Fale com a recepção.';

/** Descobre se o usuário logado é gestor, aluno ou nenhum dos dois. */
async function verificarPapel() {
  const { data: { session } } = await sb.auth.getSession();
  estado.principal = false;
  estado.cadastrosPendentes = [];
  if (!session) { estado.papel = null; estado.email = null; estado.trocarSenha = false; return null; }
  estado.email = session.user.email;
  estado.trocarSenha = session.user.user_metadata?.trocar_senha === true;
  const buscarEquipe = async () => {
    const { data, error } = await sb.from('gestores').select('user_id,papel').eq('user_id', session.user.id).maybeSingle();
    if (!error) return data;
    // banco ainda sem a coluna "papel" (schema.sql antigo): todo gestor é principal
    const antigo = await sb.from('gestores').select('user_id').eq('user_id', session.user.id).maybeSingle();
    return antigo.error ? null : antigo.data;
  };
  let g = await buscarEquipe();
  if (!g) {
    // admin convidado entrando pela primeira vez
    const { data: aceitou, error: e1 } = await sb.rpc('aceitar_convite_admin');
    if (e1) console.warn('aceitar_convite_admin:', e1.message);
    if (aceitou) g = await buscarEquipe();
  }
  if (g) {
    estado.principal = (g.papel ?? 'gestor') === 'gestor';
    return (estado.papel = 'gestor');
  }
  const { data: qtd, error: e2 } = await sb.rpc('vincular_aluno');
  estado.erroVinculo = e2 ? e2.message : null;
  if (e2) console.warn('vincular_aluno:', e2.message);
  estado.papel = !e2 && qtd > 0 ? 'aluno' : null;
  if (estado.papel === 'aluno') {
    const { data: pend, error: e3 } = await sb.rpc('aluno_cadastro_pendente');
    if (e3) console.warn('aluno_cadastro_pendente:', e3.message);
    estado.cadastrosPendentes = Array.isArray(pend) ? pend : [];
  }
  return estado.papel;
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

  // Primeiro acesso: obrigatório criar a própria senha e (aluno) completar o cadastro.
  if (primeiroAcessoPendente()) {
    if (rota) history.replaceState(null, '', '#/');
    desenharTopo('', { bloqueado: true });
    window.scrollTo(0, 0);
    const { renderPrimeiroAcesso } = await import('./primeiro-acesso.js');
    if (minha !== versaoRota) return;
    await renderPrimeiroAcesso(raiz, {
      trocarSenha: estado.trocarSenha,
      pendentes: estado.cadastrosPendentes,
      aoConcluir: async () => { await verificarPapel(); await rotear(); toast('Tudo pronto! Bem-vindo(a) ao app CEVISA.'); },
    });
    return;
  }

  const permitidas = estado.papel === 'gestor'
    ? ['', ...ROTAS_GESTOR.filter((r) => r !== 'equipe' || estado.principal)]
    : ['', 'aulas'];
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
    } else if (rota === 'equipe') {
      const { renderEquipe } = await import('./equipe.js');
      if (minha !== versaoRota) return;
      await renderEquipe(raiz);
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
    toast(msgSemCadastro(), 'erro');
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
