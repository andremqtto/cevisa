// Anúncios.
//  - Aba "Anúncios" (gestor/admins): cria, programa, repete, define expiração, pausa e exclui.
//  - Balão flutuante para alunos e professores, com "Entendi" liberado só após 5 segundos.
import { sb, ok } from './supabase.js';
import { esc, fmtDate, hojeISO, abrirModal, toast, confirmar, comBotao, carregando, vazio, erroBox } from './ui.js';

const SEGUNDOS_ENTENDI = 5;
const REPETICAO = { unica: 'Uma vez', diaria: 'Todo dia', semanal: 'Toda semana', mensal: 'Todo mês' };
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ICONE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;

const hora = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dataHora = (iso) => { const d = new Date(iso); return `${fmtDate(isoLocal(d))} às ${hora(d)}`; };
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const paraInputLocal = (iso) => { const d = new Date(iso); return `${isoLocal(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** "Todo dia às 09:00", "Toda quinta-feira às 09:00", "Todo dia 20 do mês às 09:00"… */
function descreverRepeticao(a) {
  const d = new Date(a.inicio);
  if (a.recorrencia === 'diaria') return `Todo dia às ${hora(d)}`;
  if (a.recorrencia === 'semanal') { const dia = d.getDay(); return `${dia === 0 || dia === 6 ? 'Todo' : 'Toda'} ${DIAS[dia]} às ${hora(d)}`; }
  if (a.recorrencia === 'mensal') return `Todo dia ${d.getDate()} do mês às ${hora(d)}`;
  return 'Uma vez';
}

function situacao(a) {
  if (a.expira_em && hojeISO() >= a.expira_em) return { chave: 'encerrado', rotulo: 'Expirado', cls: 'cinza' };
  if (!a.ativo) return { chave: 'encerrado', rotulo: 'Pausado', cls: 'alerta' };
  if (new Date(a.inicio) > new Date()) return { chave: 'programado', rotulo: 'Programado', cls: 'info' };
  return { chave: 'no-ar', rotulo: 'No ar', cls: 'ok' };
}

// ================================================================== aba dos admins
export async function renderAnuncios(el) {
  el.innerHTML = carregando('Carregando anúncios…');
  let anuncios;
  try {
    anuncios = ok(await sb.from('anuncios').select('*, anuncios_vistos(count)').order('inicio', { ascending: false }));
  } catch (e) {
    el.innerHTML = /anuncios/i.test(e.message)
      ? erroBox(new Error('A tabela de anúncios ainda não existe. Rode o arquivo supabase/schema.sql no SQL Editor do Supabase.'))
      : erroBox(e);
    return;
  }
  const recarregar = () => renderAnuncios(el);
  const grupos = { 'no-ar': [], programado: [], encerrado: [] };
  anuncios.forEach((a) => grupos[situacao(a).chave].push(a));
  grupos.programado.sort((x, y) => new Date(x.inicio) - new Date(y.inicio));

  const item = (a) => {
    const s = situacao(a);
    const vistos = a.anuncios_vistos?.[0]?.count ?? 0;
    const expirou = s.rotulo === 'Expirado';
    return `
      <li class="anuncio-item">
        <div class="anuncio-item-corpo">
          <div class="anuncio-item-titulo"><strong>${esc(a.titulo || 'Anúncio')}</strong> <span class="badge ${s.cls}">${s.rotulo}</span></div>
          <p class="anuncio-item-texto">${esc(a.mensagem)}</p>
          <small>${esc(descreverRepeticao(a))} · ${a.recorrencia === 'unica' ? 'em' : 'desde'} ${dataHora(a.inicio)}
            · ${a.expira_em ? `${expirou ? 'expirou' : 'expira'} em ${fmtDate(a.expira_em)}` : 'sem expiração'}
            · ${vistos} ${vistos === 1 ? 'confirmação' : 'confirmações'} de leitura</small>
        </div>
        <div class="acoes-linha">
          <button class="btn sec pequeno" type="button" data-previa="${a.id}">Prévia</button>
          <button class="btn sec pequeno" type="button" data-editar="${a.id}">Editar</button>
          ${expirou ? '' : `<button class="btn sec pequeno" type="button" data-pausar="${a.id}">${a.ativo ? 'Pausar' : 'Reativar'}</button>`}
          <button class="btn sec perigo pequeno" type="button" data-excluir="${a.id}">Excluir</button>
        </div>
      </li>`;
  };
  const secao = (titulo, lista, textoVazio) => `
    <section class="card">
      <h2>${titulo} <span class="badge">${lista.length}</span></h2>
      ${lista.length ? `<ul class="lista-equipe">${lista.map(item).join('')}</ul>` : vazio(textoVazio)}
    </section>`;

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Anúncios</h1><p class="sub">Avisos para todos os alunos e professores. Aparecem num balão ao abrir o app, e a pessoa confirma com “Entendi”.</p></div>
      <button class="btn" type="button" id="novo-anuncio">＋ Novo anúncio</button>
    </div>
    ${secao('No ar', grupos['no-ar'], 'Nenhum anúncio no ar agora.')}
    ${secao('Programados', grupos.programado, 'Nenhum anúncio programado.')}
    ${grupos.encerrado.length ? secao('Pausados e expirados', grupos.encerrado, '') : ''}`;

  el.querySelector('#novo-anuncio').onclick = () => editarAnuncio(null, recarregar);
  el.onclick = async (e) => {
    const alvo = e.target.closest('[data-previa],[data-editar],[data-pausar],[data-excluir]');
    if (!alvo) return;
    const botao = alvo;
    const a = anuncios.find((x) => x.id === (alvo.dataset.previa || alvo.dataset.editar || alvo.dataset.pausar || alvo.dataset.excluir));
    if (!a) return;
    if (alvo.dataset.previa) return mostrarBalao(a, { previa: true });
    if (alvo.dataset.editar) return editarAnuncio(a, recarregar);
    if (alvo.dataset.pausar) {
      return comBotao(botao, async () => {
        ok(await sb.from('anuncios').update({ ativo: !a.ativo }).eq('id', a.id));
        toast(a.ativo ? 'Anúncio pausado.' : 'Anúncio reativado.');
        recarregar();
      });
    }
    if (alvo.dataset.excluir) {
      if (!(await confirmar(`Excluir o anúncio “${a.titulo || a.mensagem.slice(0, 40)}”? Ele deixa de aparecer para todos.`, { titulo: 'Excluir anúncio', confirmarTexto: 'Excluir', perigo: true }))) return;
      return comBotao(botao, async () => {
        ok(await sb.from('anuncios').delete().eq('id', a.id));
        toast('Anúncio excluído.');
        recarregar();
      });
    }
  };
}

function editarAnuncio(a, aoSalvar) {
  const novo = !a;
  const m = abrirModal({
    titulo: novo ? 'Novo anúncio' : 'Editar anúncio',
    largura: 560,
    corpo: `
      <form id="f-anuncio" novalidate>
        <label class="campo"><span>Título</span><input type="text" name="titulo" maxlength="120" placeholder="Ex.: Recesso de fim de ano" value="${esc(a?.titulo || '')}"><small>Opcional.</small></label>
        <label class="campo"><span>Mensagem *</span><textarea name="mensagem" maxlength="2000" rows="5" required>${esc(a?.mensagem || '')}</textarea></label>

        <fieldset class="vinculo">
          <legend>Quando aparece</legend>
          <label class="check vinculo-opcao"><input type="radio" name="quando" value="agora" ${novo ? 'checked' : ''}><span>Agora</span></label>
          <label class="check vinculo-opcao"><input type="radio" name="quando" value="programar" ${novo ? '' : 'checked'}><span>Programar data e hora</span></label>
        </fieldset>
        <label class="campo" id="campo-inicio" ${novo ? 'hidden' : ''}><span>Começa em *</span>
          <input type="datetime-local" name="inicio" value="${a ? paraInputLocal(a.inicio) : ''}"></label>

        <div class="grade2">
          <label class="campo"><span>Repetir</span>
            <select name="recorrencia">${Object.entries(REPETICAO).map(([v, t]) => `<option value="${v}" ${(a?.recorrencia || 'unica') === v ? 'selected' : ''}>${v === 'unica' ? 'Não repetir (uma vez)' : t}</option>`).join('')}</select>
            <small id="dica-repeticao"></small></label>
          <label class="campo"><span>Expira em</span><input type="date" name="expira_em" value="${a?.expira_em || ''}">
            <small>Opcional. O anúncio some sozinho a partir deste dia.</small></label>
        </div>
        <div id="an-erro"></div>
        <div class="acoes">
          <button class="btn sec" type="button" data-previa>Prévia</button>
          <button class="btn" type="submit">${novo ? 'Publicar anúncio' : 'Salvar'}</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-anuncio');
  const erro = (t) => { m.el.querySelector('#an-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };

  const inicioEscolhido = () => (form.quando.value === 'programar' && form.inicio.value ? new Date(form.inicio.value) : new Date());
  const atualizarDica = () => {
    m.el.querySelector('#campo-inicio').hidden = form.quando.value !== 'programar';
    const rec = form.recorrencia.value;
    m.el.querySelector('#dica-repeticao').textContent = rec === 'unica'
      ? 'Cada pessoa vê uma vez.'
      : `${descreverRepeticao({ recorrencia: rec, inicio: inicioEscolhido().toISOString() })}, até expirar ou ser pausado.`;
  };
  form.addEventListener('change', atualizarDica);
  form.inicio.addEventListener('input', atualizarDica);
  atualizarDica();

  const ler = () => ({
    titulo: form.titulo.value.trim() || null,
    mensagem: form.mensagem.value.trim(),
    inicio: inicioEscolhido().toISOString(),
    recorrencia: form.recorrencia.value,
    expira_em: form.expira_em.value || null,
  });
  const validar = (d) => {
    if (!d.mensagem) return 'Escreva a mensagem do anúncio.';
    if (form.quando.value === 'programar' && !form.inicio.value) return 'Escolha a data e a hora em que o anúncio começa.';
    if (d.expira_em && d.expira_em <= isoLocal(new Date(d.inicio))) return 'A data de expiração precisa ser depois do dia em que o anúncio começa.';
    return null;
  };

  form.querySelector('[data-previa]').onclick = () => {
    const d = ler();
    if (!d.mensagem) return erro('Escreva a mensagem para ver a prévia.');
    erro('');
    mostrarBalao(d, { previa: true });
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = ler();
    const problema = validar(d);
    if (problema) return erro(problema);
    erro('');
    await comBotao(form.querySelector('[type=submit]'), async () => {
      try {
        if (novo) ok(await sb.from('anuncios').insert(d));
        else ok(await sb.from('anuncios').update(d).eq('id', a.id));
        m.fechar();
        toast(novo ? (new Date(d.inicio) > new Date() ? 'Anúncio programado.' : 'Anúncio publicado.') : 'Anúncio salvo.');
        aoSalvar();
      } catch (err) { erro(err.message); }
    });
  });
}

// ================================================================== balão (alunos e professores)
let fila = [];
let atual = null;
let timer = null;
const jaMostrados = new Set(); // evita repetir na mesma sessão se a confirmação falhar

const chave = (a) => `${a.id}|${a.ocorrencia}`;

/** Mostra um anúncio no balão. Prévia: não registra nada, só fecha. */
function mostrarBalao(a, { previa = false, aoEntender } = {}) {
  document.getElementById('anuncio-balao')?.remove();
  const balao = document.createElement('div');
  balao.id = 'anuncio-balao';
  balao.className = 'anuncio-balao';
  balao.setAttribute('role', 'alertdialog');
  balao.setAttribute('aria-labelledby', 'anuncio-titulo');
  balao.setAttribute('aria-describedby', 'anuncio-texto');
  const restantes = previa ? 0 : fila.length;
  balao.innerHTML = `
    <div class="anuncio-topo">${ICONE}<span>${previa ? 'Prévia do anúncio' : 'Aviso do Cevisa'}</span>${restantes ? `<span class="anuncio-mais">+${restantes}</span>` : ''}</div>
    <h3 id="anuncio-titulo">${esc(a.titulo || 'Aviso')}</h3>
    <p id="anuncio-texto" class="anuncio-texto">${esc(a.mensagem)}</p>
    <button class="btn" type="button" disabled>Entendi (${SEGUNDOS_ENTENDI})</button>`;
  document.body.appendChild(balao);

  const btn = balao.querySelector('button');
  let s = SEGUNDOS_ENTENDI;
  const contagem = setInterval(() => {
    s -= 1;
    if (!balao.isConnected) return clearInterval(contagem);
    if (s > 0) { btn.textContent = `Entendi (${s})`; return; }
    clearInterval(contagem);
    btn.disabled = false;
    btn.textContent = 'Entendi';
    btn.focus({ preventScroll: true });
  }, 1000);
  btn.onclick = () => {
    if (btn.disabled) return;
    balao.classList.add('sai');
    setTimeout(() => balao.remove(), 200);
    aoEntender?.();
  };
}

function proximo() {
  if (atual || !fila.length) return;
  atual = fila.shift();
  const a = atual;
  mostrarBalao(a, {
    aoEntender: async () => {
      jaMostrados.add(chave(a));
      atual = null;
      const { error } = await sb.rpc('anuncio_entendi', { p_anuncio: a.id, p_ocorrencia: a.ocorrencia });
      if (error) console.warn('anuncio_entendi:', error.message);
      setTimeout(proximo, 350);
    },
  });
}

async function verificar() {
  const { data, error } = await sb.rpc('meus_anuncios');
  if (error) { console.warn('meus_anuncios:', error.message); return; }
  for (const a of data || []) {
    const k = chave(a);
    if (jaMostrados.has(k) || (atual && chave(atual) === k) || fila.some((f) => chave(f) === k)) continue;
    fila.push(a);
  }
  proximo();
}

const aoVoltar = () => { if (document.visibilityState === 'visible') verificar(); };

/** Liga a verificação de anúncios (ao entrar, a cada 5 min e ao voltar para o app). */
export function iniciarAnuncios() {
  if (timer) return;
  verificar();
  timer = setInterval(verificar, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', aoVoltar);
}

export function pararAnuncios() {
  if (timer) clearInterval(timer);
  timer = null;
  fila = [];
  atual = null;
  document.removeEventListener('visibilitychange', aoVoltar);
  document.getElementById('anuncio-balao')?.remove();
}
