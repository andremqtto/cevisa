// Tela inicial: aulas e preços (pública). Gestores editam tudo aqui.
import { sb, ok } from './supabase.js';
import { esc, money, abrirModal, toast, confirmar, comBotao, carregando, vazio, erroBox, planoLabel } from './ui.js';

const FOTO_MAX = 5 * 1024 * 1024;

export async function renderHome(el, { isGestor, abrirLogin }) {
  el.innerHTML = carregando('Carregando aulas…');
  try {
    let aulas, ocupacao = {};
    if (isGestor) {
      aulas = ok(await sb.from('aulas').select('*').order('ordem').order('nome'));
      const mats = ok(await sb.from('matriculas').select('aula_id,status').in('status', ['ativa', 'espera']));
      for (const m of mats) {
        const o = (ocupacao[m.aula_id] ??= { ativa: 0, espera: 0 });
        o[m.status]++;
      }
    } else {
      aulas = ok(await sb.from('aulas_publicas').select('*'));
    }
    desenhar(el, aulas, ocupacao, { isGestor, abrirLogin });
  } catch (e) {
    el.innerHTML = erroBox(e);
  }
}

function desenhar(el, aulas, ocupacao, ctx) {
  const { isGestor } = ctx;
  el.innerHTML = `
    <section class="hero">
      <h1>Nossas aulas</h1>
      <p class="sub">Conheça as modalidades do Spa Médico Adventista Cevisa e escolha a sua.</p>
    </section>
    ${isGestor ? '<div class="aviso info no-print">Você está logado como gestor: pode editar as aulas, os preços e as fotos. As vagas só aparecem para você.</div>' : ''}
    <div class="grade-aulas">
      ${aulas.map((a) => cartao(a, ocupacao[a.id], isGestor)).join('')}
      ${isGestor ? '<button class="nova-aula" data-nova type="button">＋ Nova aula</button>' : ''}
    </div>
    ${!aulas.length && !isGestor ? vazio('Em breve, novas aulas por aqui.') : ''}
    ${!isGestor ? '<p class="sub" style="margin-top:28px">Para se inscrever, procure a recepção do Spa Médico Adventista Cevisa.</p>' : ''}`;

  el.onclick = (e) => {
    const b = e.target.closest('[data-nova],[data-editar],[data-turma]');
    if (!b) return;
    if (b.hasAttribute('data-nova')) return editarAula(null, () => renderHome(el, ctx));
    const aula = aulas.find((a) => a.id === (b.dataset.editar || b.dataset.turma));
    if (b.dataset.editar) editarAula(aula, () => renderHome(el, ctx));
    else verTurma(aula);
  };
}

function precoBox(rotulo, valor, meses) {
  const porMes = valor && meses > 1 ? `${money(valor / meses)}/mês` : '';
  return `<div class="preco"><span>${rotulo}</span><strong>${valor === null || valor === undefined ? 'Consulte' : money(valor)}</strong><small>${porMes}</small></div>`;
}

function cartao(a, oc, isGestor) {
  const foto = a.foto_url
    ? `<img src="${esc(a.foto_url)}" alt="Foto da aula de ${esc(a.nome)}" loading="lazy">`
    : `<span class="inicial" aria-hidden="true">${esc(a.nome.charAt(0))}</span>`;
  const o = oc || { ativa: 0, espera: 0 };
  const cheia = isGestor && o.ativa >= a.vagas;
  return `
    <article class="aula ${isGestor && !a.ativa ? 'oculta' : ''}">
      <div class="aula-foto">${foto}${isGestor && !a.ativa ? '<span class="selo">Oculta ao público</span>' : ''}</div>
      <div class="aula-corpo">
        <h2>${esc(a.nome)}</h2>
        ${a.descricao ? `<p>${esc(a.descricao)}</p>` : ''}
        <div class="precos">
          ${precoBox('Mensal', a.preco_mensal, 1)}
          ${precoBox('Semestral', a.preco_semestral, 6)}
          ${precoBox('Anual', a.preco_anual, 12)}
        </div>
        ${isGestor ? `
          <div class="vagas-gestor no-print">
            <span class="badge ${cheia ? 'erro' : 'ok'}">${o.ativa}/${a.vagas} vagas</span>
            <span>${cheia ? 'Turma cheia · ' : ''}${o.espera} na lista de espera</span>
          </div>
          <div class="aula-acoes no-print">
            <button class="btn sec pequeno" data-turma="${a.id}" type="button">Ver turma</button>
            <button class="btn pequeno" data-editar="${a.id}" type="button">Editar</button>
          </div>` : ''}
      </div>
    </article>`;
}

// ------------------------------------------------------------------ turma
async function verTurma(aula) {
  const m = abrirModal({ titulo: `Turma — ${aula.nome}`, largura: 560, corpo: carregando() });
  try {
    const mats = ok(await sb.from('matriculas')
      .select('id,status,plano,created_at,alunos(id,nome,ativo)')
      .eq('aula_id', aula.id).in('status', ['ativa', 'espera']).order('created_at'));
    const ativos = mats.filter((x) => x.status === 'ativa');
    const espera = mats.filter((x) => x.status === 'espera');
    const lista = (arr, fila) => arr.length
      ? `<ol style="margin:0;padding-left:${fila ? 22 : 22}px">${arr.map((x) => `
          <li style="margin:5px 0"><a href="#/alunos/${x.alunos.id}" data-ir>${esc(x.alunos.nome)}</a>
          <span class="badge">${planoLabel(x.plano)}</span>${x.alunos.ativo ? '' : ' <span class="badge cinza">Desativado</span>'}</li>`).join('')}</ol>`
      : vazio(fila ? 'Ninguém na lista de espera.' : 'Nenhum aluno inscrito.');
    m.el.innerHTML = `
      <p><span class="badge ${ativos.length >= aula.vagas ? 'erro' : 'ok'}">${ativos.length}/${aula.vagas} vagas ocupadas</span></p>
      <h3 style="margin:14px 0 6px">Alunos inscritos</h3>${lista(ativos, false)}
      <h3 style="margin:18px 0 6px">Lista de espera (por ordem de reserva)</h3>${lista(espera, true)}`;
    m.el.addEventListener('click', (e) => { if (e.target.closest('[data-ir]')) m.fechar(); });
  } catch (e) {
    m.el.innerHTML = erroBox(e);
  }
}

// ------------------------------------------------------------------ editar / criar aula
function editarAula(aula, aoSalvar) {
  const novo = !aula;
  const a = aula || { nome: '', descricao: '', foto_url: null, preco_mensal: null, preco_semestral: null, preco_anual: null, vagas: 20, ativa: true, ordem: 0 };
  const m = abrirModal({
    titulo: novo ? 'Nova aula' : `Editar — ${a.nome}`,
    largura: 580,
    corpo: `
      <form id="f-aula" novalidate>
        <label class="campo"><span>Nome da aula *</span><input type="text" name="nome" required maxlength="80" value="${esc(a.nome)}"></label>
        <label class="campo"><span>Descrição</span><textarea name="descricao" maxlength="400">${esc(a.descricao)}</textarea></label>
        <div class="grade3">
          <label class="campo"><span>Mensal (R$)</span><input type="number" name="preco_mensal" min="0" step="0.01" inputmode="decimal" value="${a.preco_mensal ?? ''}"></label>
          <label class="campo"><span>Semestral (R$)</span><input type="number" name="preco_semestral" min="0" step="0.01" inputmode="decimal" value="${a.preco_semestral ?? ''}"></label>
          <label class="campo"><span>Anual (R$)</span><input type="number" name="preco_anual" min="0" step="0.01" inputmode="decimal" value="${a.preco_anual ?? ''}"></label>
        </div>
        <p class="sub" style="margin:-6px 0 14px">Semestral e anual são o valor <strong>total</strong> do plano. Deixe em branco para exibir “Consulte”.</p>
        <div class="grade2">
          <label class="campo"><span>Vagas *</span><input type="number" name="vagas" min="0" step="1" required value="${a.vagas}"><small>Só gestores veem este número.</small></label>
          <label class="campo"><span>Ordem na tela</span><input type="number" name="ordem" step="1" value="${a.ordem}"><small>Menor número aparece primeiro.</small></label>
        </div>
        <div class="campo">
          <span>Foto da aula</span>
          <div id="previa-wrap">${a.foto_url ? `<img class="foto-previa" id="previa" src="${esc(a.foto_url)}" alt="">` : '<img class="foto-previa" id="previa" alt="" hidden>'}</div>
          <input type="file" name="foto" accept="image/jpeg,image/png,image/webp">
          <small>JPG, PNG ou WebP, até 5 MB.</small>
          ${a.foto_url ? '<label class="check" style="margin:8px 0 0;font-weight:500"><input type="checkbox" name="remover_foto"> Remover foto atual</label>' : ''}
        </div>
        <label class="check"><input type="checkbox" name="ativa" ${a.ativa ? 'checked' : ''}> Exibir esta aula na tela pública</label>
        <div id="f-erro"></div>
        <div class="acoes">
          ${novo ? '' : '<button type="button" class="btn perigo sec esq" data-excluir>Excluir</button>'}
          <button type="button" class="btn sec" data-cancelar>Cancelar</button>
          <button type="submit" class="btn">Salvar</button>
        </div>
      </form>`,
  });
  const form = m.el.querySelector('#f-aula');
  const erro = (t) => { m.el.querySelector('#f-erro').innerHTML = t ? `<div class="aviso erro">${esc(t)}</div>` : ''; };
  m.el.querySelector('[data-cancelar]').onclick = () => m.fechar();

  form.foto.addEventListener('change', () => {
    const f = form.foto.files[0];
    const previa = m.el.querySelector('#previa');
    if (!f) return;
    if (f.size > FOTO_MAX) { erro('A foto passa de 5 MB. Escolha uma menor.'); form.foto.value = ''; return; }
    erro('');
    previa.src = URL.createObjectURL(f);
    previa.hidden = false;
  });

  m.el.querySelector('[data-excluir]')?.addEventListener('click', async (e) => {
    const sim = await confirmar(`Excluir a aula “${a.nome}”? Se houver alunos matriculados, a exclusão não será permitida (use “Exibir esta aula” desmarcado para ocultá-la).`, { titulo: 'Excluir aula', confirmarTexto: 'Excluir', perigo: true });
    if (!sim) return;
    await comBotao(e.currentTarget, async () => {
      try {
        ok(await sb.from('aulas').delete().eq('id', a.id));
        toast('Aula excluída.');
        m.fechar();
        aoSalvar();
      } catch (err) {
        erro(err.code === '23503' ? 'Esta aula tem alunos (ou histórico) ligados a ela. Desmarque “Exibir esta aula” para ocultá-la.' : err.message);
      }
    });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const num = (n) => (form[n].value === '' ? null : Number(form[n].value));
    const nome = form.nome.value.trim();
    if (!nome) return erro('Informe o nome da aula.');
    const vagas = Number(form.vagas.value);
    if (!Number.isInteger(vagas) || vagas < 0) return erro('Vagas deve ser um número inteiro (0 ou mais).');
    for (const n of ['preco_mensal', 'preco_semestral', 'preco_anual']) {
      if (num(n) !== null && num(n) < 0) return erro('Os preços não podem ser negativos.');
    }
    erro('');
    await comBotao(btn, async () => {
      let foto_url = a.foto_url;
      if (form.remover_foto?.checked) foto_url = null;
      const arq = form.foto.files[0];
      if (arq) {
        const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[arq.type];
        if (!ext) throw new Error('Formato de foto não aceito. Use JPG, PNG ou WebP.');
        const caminho = `${crypto.randomUUID()}.${ext}`;
        ok(await sb.storage.from('aulas').upload(caminho, arq, { contentType: arq.type, cacheControl: '31536000' }));
        foto_url = sb.storage.from('aulas').getPublicUrl(caminho).data.publicUrl;
      }
      const dados = {
        nome,
        descricao: form.descricao.value.trim() || null,
        preco_mensal: num('preco_mensal'),
        preco_semestral: num('preco_semestral'),
        preco_anual: num('preco_anual'),
        vagas,
        ordem: Number(form.ordem.value) || 0,
        ativa: form.ativa.checked,
        foto_url,
      };
      ok(novo ? await sb.from('aulas').insert(dados) : await sb.from('aulas').update(dados).eq('id', a.id));
      toast(novo ? 'Aula criada.' : 'Aula atualizada.');
      m.fechar();
      aoSalvar();
    });
  });
}
