// Edge Function "criar-usuario" — cria contas com senha temporária.
// Só gestores/admins podem chamar. A chave de serviço fica no servidor do Supabase, nunca no app.
//
// Ações (corpo JSON):
//   { acao: 'criar_aluno', email }      -> cria (ou reaproveita) a conta e a ficha do aluno; devolve a senha temporária
//   { acao: 'nova_senha', user_id }     -> gera nova senha temporária para um ALUNO
//   { acao: 'criar_admin', email, nome} -> só o gestor principal; cria a conta de admin (ou promove conta existente)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falha = (erro: string, status = 400) => responder({ erro }, status);

// Senha fácil de ditar: sem letras/números parecidos (0/O, 1/l/I).
function senhaTemporaria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'Cevisa-' + Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
const emailValido = (e: string) => /^\S+@\S+\.\S+$/.test(e);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falha('Método não permitido.', 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const chamador = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: ehGestor } = await chamador.rpc('is_gestor');
    const { data: ehProfessor } = ehGestor ? { data: false } : await chamador.rpc('is_professor');
    if (!ehGestor && !ehProfessor) return falha('Apenas a equipe pode fazer isso.', 403);
    const { data: { user: quemChama } } = await chamador.auth.getUser();

    const corpo = await req.json().catch(() => ({}));
    const acao = String(corpo.acao || '');
    // Professor só pode cadastrar alunos novos.
    if (ehProfessor && acao !== 'criar_aluno') return falha('Professores só podem cadastrar alunos.', 403);
    const email = String(corpo.email || '').trim().toLowerCase();

    const usuarioPorEmail = async (e: string): Promise<string | null> => {
      const { data, error } = await admin.rpc('_usuario_por_email', { p_email: e });
      if (error) throw error;
      return data ?? null;
    };
    const ehDaEquipe = async (userId: string) => {
      const { data, error } = await admin.from('gestores').select('user_id').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return !!data;
    };
    const definirSenhaTemporaria = async (userId: string) => {
      const senha = senhaTemporaria();
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password: senha, email_confirm: true, user_metadata: { trocar_senha: true },
      });
      if (error) throw error;
      return senha;
    };
    const criarConta = async (e: string) => {
      const senha = senhaTemporaria();
      const { data, error } = await admin.auth.admin.createUser({
        email: e, password: senha, email_confirm: true, user_metadata: { trocar_senha: true },
      });
      if (error) throw error;
      return { userId: data.user.id, senha };
    };

    // ------------------------------------------------------------ novo aluno
    if (acao === 'criar_aluno') {
      if (!emailValido(email)) return falha('E-mail inválido.');
      const { data: fichas, error: eF } = await admin.from('alunos').select('id,user_id').ilike('email', email.replace(/[%_\\]/g, '\\$&')); // comparação sem diferenciar maiúsculas
      if (eF) throw eF;

      let userId = await usuarioPorEmail(email);
      let senha: string;
      let criouConta = false;
      if (userId) {
        if (await ehDaEquipe(userId)) return falha('Este e-mail pertence a um gestor/admin e não pode ser usado para aluno.');
        if (fichas?.some((f) => f.user_id === userId)) {
          return falha(ehProfessor
            ? 'Já existe um aluno com este e-mail. Se ele esqueceu a senha, peça à recepção para gerar uma nova.'
            : 'Já existe um aluno com este e-mail. Abra a ficha dele e use “Gerar nova senha” se ele esqueceu a senha.', 409);
        }
        senha = await definirSenhaTemporaria(userId); // conta criada antes (ex.: cadastro antigo): reaproveita
      } else {
        const r = await criarConta(email);
        userId = r.userId; senha = r.senha; criouConta = true;
      }

      // Já existe ficha com esse e-mail sem conta ligada? Liga a ela. Senão cria uma ficha nova (a completar).
      const livre = fichas?.find((f) => !f.user_id);
      let alunoId: string;
      if (livre) {
        const { error } = await admin.from('alunos').update({ user_id: userId }).eq('id', livre.id);
        if (error) throw error;
        alunoId = livre.id;
      } else {
        const { data, error } = await admin.from('alunos')
          .insert({ nome: email, email, user_id: userId, cadastro_completo: false, criado_por: quemChama?.id ?? null })
          .select('id').single();
        if (error) {
          if (criouConta) await admin.auth.admin.deleteUser(userId);
          throw error;
        }
        alunoId = data.id;
      }
      return responder({ aluno_id: alunoId, email, senha });
    }

    // ------------------------------------------------------------ nova senha temporária (aluno)
    if (acao === 'nova_senha') {
      const userId = String(corpo.user_id || '');
      if (!userId) return falha('Usuário não informado.');
      if (await ehDaEquipe(userId)) return falha('Não é possível trocar a senha de um gestor/admin por aqui.', 403);
      const { data: ficha, error } = await admin.from('alunos').select('id,email').eq('user_id', userId).limit(1).maybeSingle();
      if (error) throw error;
      if (!ficha) return falha('Aluno não encontrado.', 404);
      const senha = await definirSenhaTemporaria(userId);
      return responder({ email: ficha.email, senha });
    }

    // ------------------------------------------------------------ novo admin (só gestor principal) ou professor (gestor ou admin)
    if (acao === 'criar_admin') {
      const papel = corpo.papel === 'professor' ? 'professor' : 'admin';
      if (papel === 'admin') {
        const { data: principal } = await chamador.rpc('is_gestor_principal');
        if (!principal) return falha('Apenas o gestor principal pode adicionar admins.', 403);
      }
      if (!emailValido(email)) return falha('E-mail inválido.');
      const nome = String(corpo.nome || '').trim().slice(0, 120) || null;
      const aulas: string[] = Array.isArray(corpo.aulas) ? corpo.aulas.map(String) : [];

      const ligarAulas = async (userId: string) => {
        if (papel !== 'professor' || !aulas.length) return;
        const { error } = await admin.from('professor_aulas').insert(aulas.map((aula_id) => ({ user_id: userId, aula_id })));
        if (error) throw error;
      };

      const existente = await usuarioPorEmail(email);
      if (existente) {
        if (await ehDaEquipe(existente)) return falha('Este e-mail já faz parte da equipe.');
        const { data: ficha } = await admin.from('alunos').select('id').eq('user_id', existente).limit(1).maybeSingle();
        if (ficha) return falha('Este e-mail é de um aluno. Use outro e-mail para a equipe.');
        const { error } = await admin.from('gestores').insert({ user_id: existente, nome, papel, email });
        if (error) throw error;
        await ligarAulas(existente);
        return responder({ status: 'ativo', email }); // já tinha conta: usa a senha que já tem
      }
      const { userId, senha } = await criarConta(email);
      const { error } = await admin.from('gestores').insert({ user_id: userId, nome, papel, email });
      if (error) { await admin.auth.admin.deleteUser(userId); throw error; }
      await ligarAulas(userId);
      return responder({ status: 'criado', email, senha });
    }

    return falha('Ação desconhecida.');
  } catch (e) {
    console.error(e);
    return falha(`Erro no servidor: ${(e as Error).message ?? e}`, 500);
  }
});
