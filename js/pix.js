// Pix "copia e cola" / QR Code no padrão do Banco Central (BR Code, EMV-MPM), com o valor já preenchido.
// Não precisa de integração com banco: é um Pix estático com a chave, o valor e o recebedor.
import * as config from './config.js';

// Campo EMV: id (2 dígitos) + tamanho (2 dígitos) + valor
const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;

// Sem acentos, só caracteres aceitos, maiúsculas e limitado ao tamanho do campo
const limpar = (t, max) => String(t || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  .toUpperCase().slice(0, max);

// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no fim do código
function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Monta o código Pix copia e cola.
 * valor: número em reais (opcional — sem valor, o aluno digita no banco).
 * descricao: texto curto que aparece para o recebedor (opcional).
 */
export function codigoPix({ valor = null, descricao = '' } = {}) {
  const chave = config.PIX_CHAVE;
  if (!chave) return null;
  const desc = limpar(descricao, 40);
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave) + (desc ? campo('02', desc) : '');
  let p = campo('00', '01')
    + campo('26', conta)
    + campo('52', '0000')
    + campo('53', '986')                                         // real
    + (valor > 0 ? campo('54', Number(valor).toFixed(2)) : '')
    + campo('58', 'BR')
    + campo('59', limpar(config.PIX_NOME || 'CEVISA', 25) || 'CEVISA')
    + campo('60', limpar(config.PIX_CIDADE || 'BRASIL', 15) || 'BRASIL')
    + campo('62', campo('05', '***'))
    + '6304';
  return p + crc16(p);
}

/** Desenha o QR Code do texto como SVG (nítido em qualquer tela). */
export async function qrSVG(texto) {
  const { default: qrcode } = await import('https://esm.sh/qrcode-generator@1.4.4');
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const m = 3; // margem em módulos
  let caminho = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) caminho += `M${x + m} ${y + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="QR Code Pix">`
    + `<rect width="100%" height="100%" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}
