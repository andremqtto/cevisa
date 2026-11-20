// Primeiro acesso: troca da senha temporária e (para alunos) cadastro, foto de perfil e aceite do termo (LGPD).
// Enquanto não concluir, o app não libera nenhuma outra tela.
import { sb, ok } from './supabase.js';
import { esc, hojeISO, comBotao, camposVinculo, camposParticipante, ligarParticipante, lerParticipante } from './ui.js';
import { campoFoto, ligarCampoFoto, salvarFoto } from './fotos.js';
import { TERMO_VERSAO, caixaTermo, abrirTermo } from './termo.js';
import { camposParq, ligarParq, lerParq } from './parq.js';

const AJUDA_FOTO = 'Foto de <strong>quem vai fazer as aulas</strong>, com o rosto bem visível. Ela aparece ao lado do nome para a recepção e o professor identificarem o aluno.';

export async function renderPrimeiroAcesso(el, { trocarSenha, pendentes, aoConcluir }) {
  const aluno = pendentes[0] || null; // um cadastro por vez (normalmente só há um)
  // complemento: cadastro antigo que já tem os dados; pede só o que falta (foto e/ou termo)
  const soFoto = !!(aluno?.so_complemento ?? aluno?.so_foto);
  const pedeFoto = !!aluno && (!soFoto || aluno.precisa_foto !== false);
  const pedeTermo = !!aluno && (!soFoto || aluno.precisa_termo !== false);
  const pedeParq = !!aluno && (!soFoto || aluno.precisa_parq !== false);
  const quem = aluno ? (aluno.participante || aluno.nome) : '';
  const passos = [pedeFoto, pedeTermo, pedeParq].filter(Boolean).length;
  const titulo = !soFoto ? (aluno ? 'Complete seu cadastro' : 'Crie sua senha')
    : passos > 1 ? `Faltam só ${passos === 2 ? 'dois' : 'três'} passos`
    : pedeFoto ? 'Falta só a foto de perfil' : pedeTermo ? 'Termo de uso e privacidade' : 'Questionário de saúde (PAR-Q)';

  el.innerHTML = `
    <div class="primeiro-acesso">
      <h1>${titulo}</h1>
      <p class="sub">${soFoto
        ? `Para continuar usando o app, ${[pedeFoto ? `envie uma foto de perfil de <strong>${esc(quem)}</strong>` : '', pedeTermo ? 'leia e aceite o termo de uso e privacidade' : '', pedeParq ? `responda o questionário de saúde (PAR-Q) de <strong>${esc(quem)}</strong>` : ''].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' e $1')}. Leva só um instante.`
        : aluno
        ? 'Bem-vindo(a) ao app do Spa Médico Adventista Cevisa! Antes de continuar, preencha seus dados' + (trocarSenha ? ' e crie sua própria senha.' : '.')
        : 'Você entrou com uma senha temporária. Crie sua própria senha para continuar.'}</p>

      <form id="f-primeiro" class="card" novalidate>
        ${soFoto ? `
          ${pedeFoto ? campoFoto({ titulo: `Foto de ${quem}`, ajuda: AJUDA_FOTO }) : ''}
          ${pedeParq ? camposParq() : ''}
          ${pedeTermo ? caixaTermo() : ''}
        ` : aluno ? `
          <h2>Seus dados (responsável)</h2>
          <p class="sub" style="margin:-4px 0 12px">Quem tem o acesso ao app e cuida dos pagamentos. Se as aulas forem para um filho ou dependente, informe logo abaixo.</p>
          <label class="campo"><span>Nome completo *</span><input type="text" name="nome" maxlength="120" autocomplete="name" required></label>
          <div class="grade2">
            <label class="campo"><span>Telefone / WhatsApp *</span><input type="tel" name="telefone" maxlength="20" autocomplete="tel" inputmode="tel" required></label>
            <label class="campo"><span>Data de nascimento</span><input type="date" name="nascimento" max="${hojeISO()}"></label>
            <label class="campo"><span>CPF</span><input type="text" name="cpf" maxlength="14" inputmode="numeric"></label>
            <label class="campo"><span>E-mail</span><input type="email" value="${esc(aluno.email)}" disabled></label>
          </div>
          <label class="campo"><span>Endereço</span><input type="text" name="endereco" maxlength="200" autocomplete="street-address"></label>
          ${camposVinculo()}
          ${camposParticipante()}
          ${campoFoto({ titulo: 'Foto de perfil', ajuda: AJUDA_FOTO })}
          ${camposParq()}
          ${caixaTermo()}
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

  if (aluno && !soFoto) ligarParticipante(form);
  if (pedeParq) ligarParq(form);
  const fotoEscolhida = pedeFoto ? ligarCampoFoto(form) : () => null;
  form.querySelector('[data-ver-termo]')?.addEventListener('click', (e) => { e.preventDefault(); abrirTermo(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let part = null;
    let parq = null;
    if (pedeFoto && !fotoEscolhida()) return erro('A foto de perfil é obrigatória. Toque em “Escolher foto”.');
    if (pedeParq) { try { parq = lerParq(form); } catch (err) { return erro(err.message); } }
    if (pedeTermo && !form.aceite_termo.checked) return erro('Para continuar, leia e aceite o Termo de uso e privacidade.');
    if (aluno && !soFoto) {
      if (!form.nome.value.trim() || form.nome.value.trim().split(/\s+/).length < 2) return erro('Informe seu nome completo (nome e sobrenome).');
      if (form.telefone.value.replace(/\D/g, '').length < 10) return erro('Informe o telefone com DDD.');
      if (!form.querySelector('[name=vinculo]:checked')) return erro('Marque o seu vínculo com o Cevisa: externo, funcionário ou prestador.');
      try { part = lerParticipante(form); } catch (err) { return erro(err.message); }
    }
    if (trocarSenha) {
      if (form.senha.value.length < 8) return erro('A nova senha precisa ter pelo menos 8 caracteres.');
      if (/^cevisa-/i.test(form.senha.value)) return erro('Crie uma senha diferente da senha temporária.');
      if (form.senha.value !== form.senha2.value) return erro('As senhas não conferem.');
    }
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        if (pedeFoto) await salvarFoto(aluno.id, fotoEscolhida());
        if (pedeTermo) ok(await sb.rpc('aceitar_termo', { p_aluno: aluno.id, p_versao: TERMO_VERSAO }));
        if (aluno && !soFoto) {
          ok(await sb.rpc('completar_cadastro', {
            p_aluno: aluno.id,
            p_nome: form.nome.value.trim(),
            p_telefone: form.telefone.value.trim(),
            p_cpf: form.cpf.value.trim() || null,
            p_nascimento: form.nascimento.value || null,
            p_endereco: form.endereco.value.trim() || null,
            p_proprio: part.proprio,
            p_participante: part.nome,
            p_participante_nasc: part.nascimento,
          }));
          ok(await sb.rpc('declarar_vinculo', { p_aluno: aluno.id, p_vinculo: form.querySelector('[name=vinculo]:checked').value }));
        }
        // depois dos dados, para o aviso da equipe sair com o nome certo
        if (pedeParq) ok(await sb.rpc('responder_parq', { p_aluno: aluno.id, p_respostas: parq }));
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
