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

function traduzErro(err) {
  const m = err.message || 'Erro inesperado.';
  if (err.code === '23503') return 'Não é possível concluir: existem registros ligados a este item.';
  if (err.code === '23505') return 'Já existe um registro igual a este.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  return m;
}
