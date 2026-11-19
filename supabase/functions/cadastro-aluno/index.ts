// Edge Function "cadastro-aluno" — o próprio aluno cria a conta pelo link de cadastro (#/cadastro).
// Pública (sem login): no Supabase, deixe DESLIGADO o "Verify JWT" / "Enforce JWT verification" desta função.
//
// Corpo JSON: { email, senha }
// Cria a conta (já confirmada, sem e-mail de confirmação) e a ficha do aluno "a completar".
// Depois o app entra com e-mail e senha e mostra o formulário completo (dados, vínculo, foto e termo).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falha = (erro: string, status = 400) => responder({ erro }, status);
const JA_TEM = 'Este e-mail já tem cadastro no app. Toque em “Entrar” e use sua senha. Se esqueceu a senha, fale com a recepção.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falha('Método não permitido.', 405);

  try {
    const corpo = await req.json().catch(() => ({}));
    if (corpo.site) return responder({ ok: true }); // campo invisível preenchido = robô
    const email = String(corpo.email || '').trim().toLowerCase();
    const senha = String(corpo.senha || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 120) return falha('Informe um e-mail válido.');
    if (senha.length < 8) return falha('A senha precisa ter pelo menos 8 caracteres.');
    if (senha.length > 72) return falha('Senha muito longa.');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existente, error: eU } = await admin.rpc('_usuario_por_email', { p_email: email });
    if (eU) throw eU;
    if (existente) return falha(JA_TEM, 409);

    const { data: criado, error: eC } = await admin.auth.admin.createUser({
      email, password: senha, email_confirm: true, user_metadata: { auto_cadastro: true },
    });
    if (eC) {
      if (/already|registered|exists/i.test(eC.message)) return falha(JA_TEM, 409);
      if (/password/i.test(eC.message)) return falha('Senha fraca. Use letras e números, com pelo menos 8 caracteres.');
      throw eC;
    }
    const userId = criado.user!.id;

    // Ficha sem conta com o mesmo e-mail (cadastrada pela recepção)? Liga a ela. Senão cria uma nova, a completar.
    const { data: fichas, error: eF } = await admin.from('alunos').select('id')
      .is('user_id', null).ilike('email', email.replace(/[%_\\]/g, '\\$&'));
    if (eF) { await admin.auth.admin.deleteUser(userId); throw eF; }
    const { error: eA } = fichas?.length
      ? await admin.from('alunos').update({ user_id: userId }).eq('id', fichas[0].id)
      : await admin.from('alunos').insert({ nome: email, email, user_id: userId, cadastro_completo: false });
    if (eA) { await admin.auth.admin.deleteUser(userId); throw eA; }

    return responder({ ok: true });
  } catch (e) {
    console.error(e);
    return falha('Não foi possível criar o cadastro agora. Tente de novo em instantes.', 500);
  }
});
