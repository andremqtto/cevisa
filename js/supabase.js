import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configurado =
  /^https?:\/\//.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.startsWith('COLE_AQUI');

export const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/** Lança o erro do Supabase com mensagem em português quando possível. */
export function ok({ data, error }) {
  if (error) {
    const e = new Error(traduzErro(error));
    e.code = error.code;
    throw e;
  }
  return data;
}

/** Chama uma Edge Function e devolve o JSON, ou lança erro com mensagem em português. */
export async function chamarFuncao(nome, corpo) {
  const { data, error } = await sb.functions.invoke(nome, { body: corpo });
  if (!error) return data;
  let msg = error.message;
  try {
    const resp = error.context;
    if (resp && typeof resp.json === 'function') {
      if (resp.status === 404) msg = `A função “${nome}” ainda não foi publicada no Supabase (veja o README).`;
      else msg = (await resp.json()).erro || msg;
    } else if (/Failed to send|fetch/i.test(msg)) {
      msg = `Não foi possível falar com o servidor. Confira a internet ou se a função “${nome}” foi publicada no Supabase.`;
    }
  } catch { /* mantém a mensagem original */ }
  throw new Error(msg);
}

export const chamarCriarUsuario = (corpo) => chamarFuncao('criar-usuario', corpo);

function traduzErro(err) {
  const m = err.message || 'Erro inesperado.';
  if (err.code === '23503') return 'Não é possível concluir: existem registros ligados a este item.';
  if (err.code === '23505') return 'Já existe um registro igual a este.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  return m;
}
