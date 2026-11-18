// Fotos de perfil dos alunos (bucket privado "perfis", pasta = id da ficha).
// - avatarHTML(): miniatura redonda ao lado do nome (iniciais enquanto carrega / sem foto)
// - ativarFotos(): busca os links assinados de uma vez e liga o "tocar para ampliar"
// - campoFoto() / ligarCampoFoto(): escolher e pré-visualizar a foto nos formulários
// - salvarFoto(): reduz a imagem, envia e grava na ficha
import { sb, ok } from './supabase.js';
import { esc, abrirModal } from './ui.js';

const BUCKET = 'perfis';
const cache = new Map(); // caminho -> { url, expira }

const iniciais = (nome) =>
  String(nome || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

/** Miniatura redonda. tamanho em px. Sem foto: só as iniciais (não amplia). */
export function avatarHTML(caminho, nome, tamanho = 36) {
  const estilo = `style="--av:${tamanho}px"`;
  if (!caminho) return `<span class="avatar sem-foto" ${estilo} aria-hidden="true">${esc(iniciais(nome))}</span>`;
  return `<button type="button" class="avatar" ${estilo} data-foto="${esc(caminho)}" data-nome="${esc(nome)}" aria-label="Ver foto de ${esc(nome)}">`
    + `<span>${esc(iniciais(nome))}</span></button>`;
}

/** Links assinados (1 h) para vários caminhos, com cache. */
export async function urlsFotos(caminhos) {
  const agora = Date.now();
  const faltam = [...new Set(caminhos.filter(Boolean))].filter((c) => !(cache.get(c)?.expira > agora));
  if (faltam.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(faltam, 3600);
    if (error) console.warn('fotos:', error.message);
    (data || []).forEach((r) => { if (r.signedUrl) cache.set(r.path, { url: r.signedUrl, expira: agora + 50 * 60 * 1000 }); });
  }
  return new Map(caminhos.filter((c) => cache.has(c)).map((c) => [c, cache.get(c).url]));
}

/** Carrega as fotos de todas as miniaturas dentro de el e liga o clique para ampliar. */
export async function ativarFotos(el) {
  const botoes = [...el.querySelectorAll('.avatar[data-foto]:not([data-ok])')];
  if (!botoes.length) return;
  botoes.forEach((b) => {
    b.dataset.ok = '1';
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); // não abre a linha/ficha por baixo
      ampliarFoto(b.dataset.foto, b.dataset.nome);
    });
  });
  const urls = await urlsFotos(botoes.map((b) => b.dataset.foto));
  botoes.forEach((b) => {
    const url = urls.get(b.dataset.foto);
    if (!url) return;
    const img = new Image();
    img.alt = '';
    img.onload = () => { b.replaceChildren(img); b.classList.add('carregada'); };
    img.src = url;
  });
}

/** Foto grande numa janela. */
export async function ampliarFoto(caminho, nome) {
  const m = abrirModal({
    titulo: nome || 'Foto',
    largura: 460,
    corpo: '<div class="foto-ampliada"><div class="carregando-foto">Carregando…</div></div>',
  });
  const url = (await urlsFotos([caminho])).get(caminho);
  const caixa = m.el.querySelector('.foto-ampliada');
  caixa.innerHTML = url ? `<img src="${esc(url)}" alt="Foto de ${esc(nome)}">` : '<p class="sub">Não foi possível carregar a foto.</p>';
}

// ------------------------------------------------------------ formulário
/** Bloco de escolha de foto. obrigatoria: mostra * e o texto de obrigatoriedade. */
export function campoFoto({ titulo = 'Foto de perfil', ajuda = '', obrigatoria = true, atual = null } = {}) {
  return `
    <div class="campo-foto">
      <div class="campo-foto-previa" ${atual ? `data-atual="${esc(atual)}"` : ''}>${ICONE_CAMERA}</div>
      <div class="campo-foto-texto">
        <strong>${esc(titulo)}${obrigatoria ? ' *' : ''}</strong>
        ${ajuda ? `<small>${ajuda}</small>` : ''}
        <label class="btn sec pequeno campo-foto-botao">
          <input type="file" name="foto" accept="image/*" hidden>
          <span>${atual ? 'Trocar foto' : 'Escolher foto'}</span>
        </label>
      </div>
    </div>`;
}

/** Liga a pré-visualização. Devolve () => File|null com a foto escolhida. */
export function ligarCampoFoto(form) {
  const input = form.querySelector('.campo-foto input[name=foto]');
  const previa = form.querySelector('.campo-foto-previa');
  let escolhida = null;
  if (previa.dataset.atual) {
    urlsFotos([previa.dataset.atual]).then((u) => {
      const url = u.get(previa.dataset.atual);
      if (url && !escolhida) previa.innerHTML = `<img src="${esc(url)}" alt="">`;
    });
  }
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { input.value = ''; return; }
    escolhida = f;
    previa.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
    previa.classList.add('ok');
    form.querySelector('.campo-foto-botao span').textContent = 'Trocar foto';
  });
  return () => escolhida;
}

/** Reduz a foto (lado maior 800 px, JPEG) — fotos de celular chegam com vários MB. */
async function reduzir(arquivo, lado = 800) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Não foi possível ler esta imagem. Escolha uma foto em JPG ou PNG.'));
      i.src = url;
    });
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * escala);
    c.height = Math.round(img.naturalHeight * escala);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Envia a foto da ficha e grava no cadastro. Devolve o caminho novo. */
export async function salvarFoto(alunoId, arquivo) {
  const blob = await reduzir(arquivo);
  if (!blob) throw new Error('Não foi possível preparar a foto. Tente outra imagem.');
  const caminho = `${alunoId}/${crypto.randomUUID()}.jpg`;
  ok(await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: 'image/jpeg' }));
  const antiga = ok(await sb.rpc('definir_foto', { p_aluno: alunoId, p_arquivo: caminho }));
  if (antiga) sb.storage.from(BUCKET).remove([antiga]).catch(() => {});
  cache.delete(antiga);
  return caminho;
}

const ICONE_CAMERA = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
