// Edge Function "enviar-comprovante": manda por e-mail o comprovante que o aluno enviou pelo app.
// O arquivo já está no Storage (bucket privado "comprovantes") e registrado em public.comprovantes.
//
// Segredos (Edge Functions > Secrets no painel do Supabase):
//   RESEND_API_KEY        -> chave da conta no https://resend.com (envio de e-mails)
//   COMPROVANTE_EMAIL     -> e-mail que recebe os comprovantes (pode ser mais de um, separados por vírgula)
//   COMPROVANTE_REMETENTE -> opcional; ex.: "CEVISA <comprovantes@seudominio.com.br>"
//                            (sem domínio verificado no Resend, use o padrão onboarding@resend.dev)
// Sem RESEND_API_KEY/COMPROVANTE_EMAIL, o comprovante continua chegando no sino do app, só não vai por e-mail.
//
// Corpo: { comprovante_id }
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const falha = (erro: string, status = 400) => responder({ erro }, status);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dinheiro = (v: unknown) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

function base64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

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

    const { data: { user } } = await chamador.auth.getUser();
    if (!user) return falha('Faça login novamente.', 401);

    const corpo = await req.json().catch(() => ({}));
    const id = String(corpo.comprovante_id || '');
    const { data: c, error } = await admin.from('comprovantes')
      .select('id, arquivo, nome_arquivo, observacao, email_enviado, created_at, alunos(id, nome, email, telefone, user_id)')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    // deno-lint-ignore no-explicit-any
    const aluno = (c as any)?.alunos;
    if (!c || !aluno || aluno.user_id !== user.id) return falha('Comprovante não encontrado.', 404);
    if (c.email_enviado) return responder({ enviado: true });

    const chave = Deno.env.get('RESEND_API_KEY');
    const destino = (Deno.env.get('COMPROVANTE_EMAIL') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!chave || !destino.length) return responder({ enviado: false, motivo: 'E-mail de destino ainda não configurado.' });

    const { data: arq, error: errArq } = await admin.storage.from('comprovantes').download(c.arquivo);
    if (errArq || !arq) throw errArq || new Error('Arquivo não encontrado.');
    const bytes = new Uint8Array(await arq.arrayBuffer());

    const { data: pend } = await admin.from('pagamentos')
      .select('valor, vencimento, plano, matriculas(aulas(nome))')
      .eq('aluno_id', aluno.id).eq('status', 'pendente').order('vencimento');
    // deno-lint-ignore no-explicit-any
    const linhas = (pend || []).map((p: any) =>
      `<tr><td>${esc(p.matriculas?.aulas?.nome)}</td><td>${esc(p.plano)}</td><td>${data(p.vencimento)}</td><td style="text-align:right">${dinheiro(p.valor)}</td></tr>`).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;color:#0d2438;max-width:560px">
        <h2 style="color:#01518a;margin:0 0 12px">Comprovante de pagamento</h2>
        <p><strong>${esc(aluno.nome)}</strong> enviou um comprovante pelo app em ${data(c.created_at)}.</p>
        <p>E-mail: ${esc(aluno.email || '—')}<br>Telefone: ${esc(aluno.telefone || '—')}</p>
        ${c.observacao ? `<p>Observação do aluno: <em>${esc(c.observacao)}</em></p>` : ''}
        ${linhas ? `<p style="margin-bottom:4px"><strong>Cobranças em aberto:</strong></p>
          <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
            <tr style="background:#e8f5fb"><th align="left">Aula</th><th align="left">Plano</th><th align="left">Vencimento</th><th align="right">Valor</th></tr>
            ${linhas}</table>` : '<p>O aluno não tem cobranças em aberto no momento.</p>'}
        <p style="color:#5a6b7a;font-size:13px;margin-top:18px">O arquivo está em anexo. Confira e registre o pagamento no app CEVISA.</p>
      </div>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('COMPROVANTE_REMETENTE') || 'CEVISA <onboarding@resend.dev>',
        to: destino,
        reply_to: aluno.email || undefined,
        subject: `Comprovante de pagamento — ${aluno.nome}`,
        html,
        attachments: [{ filename: c.nome_arquivo || c.arquivo.split('/').pop(), content: base64(bytes) }],
      }),
    });
    if (!r.ok) {
      console.error('Resend:', r.status, await r.text());
      return responder({ enviado: false, motivo: 'Falha ao enviar o e-mail.' });
    }
    await admin.from('comprovantes').update({ email_enviado: true }).eq('id', c.id);
    return responder({ enviado: true });
  } catch (e) {
    console.error(e);
    return falha(e instanceof Error ? e.message : 'Erro inesperado.', 500);
  }
});
