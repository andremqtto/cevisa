// Preencha com os dados do seu projeto Supabase:
// Supabase > Project Settings > API
export const SUPABASE_URL = 'https://zgejlroyiwfggklfxtsm.supabase.co';        // ex.: https://abcdxyz.supabase.co
export const SUPABASE_ANON_KEY = 'sb_publishable_TZN23loWmLtOd4VM0Hz1JA_L7B0-GQ_'; // chave "anon public" (NUNCA use a service_role aqui)

// Número do WhatsApp do gestor/recepção, com DDI e DDD, só números. Ex.: '5511912345678'
// Usado no balão do WhatsApp (visitantes e alunos).
export const WHATSAPP_NUMERO = '5519998864617';

// Chave Pix que recebe as mensalidades (aparece no painel do aluno, em "Pagar com Pix").
// PIX_CHAVE é o que o aluno copia (CNPJ só com números); PIX_EXIBICAO é como ela aparece na tela.
export const PIX_CHAVE = '21636951000202';
export const PIX_TIPO = 'CNPJ';
export const PIX_EXIBICAO = '21.636.951/0002-02';

// Endereço público do app (usado no QR Code da aba Alunos).
export const APP_URL = 'https://cevisa.vercel.app';
