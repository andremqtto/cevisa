// Cadastro pelo próprio aluno (link #/cadastro enviado pela equipe).
// Passo 1 (aqui): e-mail e senha → cria a conta pela Edge Function "cadastro-aluno" e já entra.
// Passo 2: o app mostra o "primeiro acesso" com o formulário completo (dados, vínculo, foto e termo).
import { sb, ok, chamarFuncao } from './supabase.js';
import { esc, comBotao } from './ui.js';

export function renderCadastro(el, { aoEntrar, abrirLogin }) {
  el.innerHTML = `
    <div class="primeiro-acesso">
      <h1>Crie seu cadastro</h1>
      <p class="sub">Bem-vindo(a) ao app do Spa Médico Adventista Cevisa! São dois passos rápidos:
        <strong>1.</strong> crie seu e-mail e senha de acesso; <strong>2.</strong> preencha seus dados e envie uma foto.</p>
      <form id="f-cadastro" class="card" novalidate>
        <h2>Seu acesso</h2>
        <p class="sub" style="margin:-4px 0 12px">Use o e-mail do <strong>responsável</strong> (para crianças e dependentes, o e-mail do pai, mãe ou responsável).</p>
        <label class="campo"><span>E-mail *</span><input type="email" name="email" maxlength="120" inputmode="email" autocapitalize="none" autocomplete="email" required></label>
        <div class="grade2">
          <label class="campo"><span>Crie uma senha *</span><input type="password" name="senha" autocomplete="new-password" minlength="8" required><small>Mínimo de 8 caracteres.</small></label>
          <label class="campo"><span>Repita a senha *</span><input type="password" name="senha2" autocomplete="new-password" required></label>
        </div>
        <input type="text" name="site" tabindex="-1" autocomplete="off" aria-hidden="true" class="campo-robo">
        <div id="c-erro"></div>
        <div class="acoes"><button class="btn" type="submit" style="width:100%">Continuar</button></div>
        <p class="login-troca">Já tem cadastro? <button type="button" class="link" data-entrar>Entrar</button></p>
      </form>
    </div>`;

  const form = el.querySelector('#f-cadastro');
  const erro = (t) => {
    el.querySelector('#c-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : '';
    if (t) el.querySelector('#c-erro').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  form.querySelector('[data-entrar]').onclick = () => abrirLogin();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const senha = form.senha.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return erro('Informe um e-mail válido.');
    if (senha.length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
    if (senha !== form.senha2.value) return erro('As senhas não conferem.');
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        await chamarFuncao('cadastro-aluno', { email, senha, site: form.site.value });
        ok(await sb.auth.signInWithPassword({ email, password: senha }));
        await aoEntrar();
      } catch (err) {
        erro(err.message);
      }
    });
  });
}
