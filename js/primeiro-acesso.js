// Primeiro acesso: troca da senha temporária e (para alunos) preenchimento do cadastro.
// Enquanto não concluir, o app não libera nenhuma outra tela.
import { sb, ok } from './supabase.js';
import { esc, hojeISO, comBotao } from './ui.js';

export async function renderPrimeiroAcesso(el, { trocarSenha, pendentes, aoConcluir }) {
  const aluno = pendentes[0] || null; // um cadastro por vez (normalmente só há um)
  const titulo = aluno ? 'Complete seu cadastro' : 'Crie sua senha';

  el.innerHTML = `
    <div class="primeiro-acesso">
      <h1>${titulo}</h1>
      <p class="sub">${aluno
        ? 'Bem-vindo(a) ao app do Spa Médico Adventista Cevisa! Antes de continuar, preencha seus dados' + (trocarSenha ? ' e crie sua própria senha.' : '.')
        : 'Você entrou com uma senha temporária. Crie sua própria senha para continuar.'}</p>

      <form id="f-primeiro" class="card" novalidate>
        ${aluno ? `
          <h2>Seus dados</h2>
          <label class="campo"><span>Nome completo *</span><input type="text" name="nome" maxlength="120" autocomplete="name" required></label>
          <div class="grade2">
            <label class="campo"><span>Telefone / WhatsApp *</span><input type="tel" name="telefone" maxlength="20" autocomplete="tel" inputmode="tel" required></label>
            <label class="campo"><span>Data de nascimento</span><input type="date" name="nascimento" max="${hojeISO()}"></label>
            <label class="campo"><span>CPF</span><input type="text" name="cpf" maxlength="14" inputmode="numeric"></label>
            <label class="campo"><span>E-mail</span><input type="email" value="${esc(aluno.email)}" disabled></label>
          </div>
          <label class="campo"><span>Endereço</span><input type="text" name="endereco" maxlength="200" autocomplete="street-address"></label>
          <label class="campo"><span>Responsável</span><input type="text" name="responsavel" maxlength="120"><small>Preencha se o aluno for criança ou bebê.</small></label>
        ` : ''}
        ${trocarSenha ? `
          <h2${aluno ? ' style="margin-top:8px"' : ''}>Sua nova senha</h2>
          <div class="grade2">
            <label class="campo"><span>Nova senha *</span><input type="password" name="senha" autocomplete="new-password" minlength="8" required><small>Mínimo de 8 caracteres.</small></label>
            <label class="campo"><span>Repita a nova senha *</span><input type="password" name="senha2" autocomplete="new-password" required></label>
          </div>
        ` : ''}
        <div id="pa-erro"></div>
        <div class="acoes"><button class="btn" type="submit">Salvar e continuar</button></div>
      </form>
    </div>`;

  const form = el.querySelector('#f-primeiro');
  const erro = (t) => {
    el.querySelector('#pa-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : '';
    if (t) el.querySelector('#pa-erro').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (aluno) {
      if (!form.nome.value.trim() || form.nome.value.trim().split(/\s+/).length < 2) return erro('Informe seu nome completo (nome e sobrenome).');
      if (form.telefone.value.replace(/\D/g, '').length < 10) return erro('Informe o telefone com DDD.');
    }
    if (trocarSenha) {
      if (form.senha.value.length < 8) return erro('A nova senha precisa ter pelo menos 8 caracteres.');
      if (/^cevisa-/i.test(form.senha.value)) return erro('Crie uma senha diferente da senha temporária.');
      if (form.senha.value !== form.senha2.value) return erro('As senhas não conferem.');
    }
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        if (aluno) {
          ok(await sb.rpc('completar_cadastro', {
            p_aluno: aluno.id,
            p_nome: form.nome.value.trim(),
            p_telefone: form.telefone.value.trim(),
            p_cpf: form.cpf.value.trim() || null,
            p_nascimento: form.nascimento.value || null,
            p_endereco: form.endereco.value.trim() || null,
            p_responsavel: form.responsavel.value.trim() || null,
          }));
        }
        if (trocarSenha) {
          const r = await sb.auth.updateUser({ password: form.senha.value, data: { trocar_senha: false } });
          if (r.error) {
            throw new Error(/should be different|same password/i.test(r.error.message)
              ? 'A nova senha precisa ser diferente da senha temporária.'
              : /weak|least/i.test(r.error.message) ? 'Senha muito fraca. Use letras e números.' : r.error.message);
          }
        }
        await aoConcluir();
      } catch (err) {
        erro(err.message);
      }
    });
  });
}
