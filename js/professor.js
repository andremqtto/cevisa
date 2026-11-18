// Painel do professor: alunos das aulas (modalidades) dele, por turma, + cadastro de alunos e QR Code.
// O professor não vê valores, pagamentos nem as fichas completas.
import { sb, ok } from './supabase.js';
import { esc, fmtDate, carregando, vazio, erroBox, horariosHTML, linkWhatsAppPara, ICONE_WHATSAPP } from './ui.js';

const idade = (nasc) => {
  if (!nasc) return null;
  const [y, m, d] = nasc.split('-').map(Number);
  const h = new Date();
  let anos = h.getFullYear() - y;
  if (h.getMonth() + 1 < m || (h.getMonth() + 1 === m && h.getDate() < d)) anos--;
  return anos;
};

export async function renderProfessor(el, { navegar }) {
  el.innerHTML = carregando('Carregando seus alunos…');
  let dados;
  try {
    dados = ok(await sb.rpc('professor_painel'));
  } catch (e) { el.innerHTML = erroBox(e); return; }
  const recarregar = () => renderProfessor(el, { navegar });
  const { aulas, cadastrados } = dados;
  const total = aulas.reduce((s, a) => s + a.alunos.filter((x) => x.status === 'ativa').length, 0);

  el.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Meus alunos</h1><p class="sub">${aulas.length ? `${total} aluno(s) inscrito(s) em ${aulas.length} modalidade(s)` : 'Alunos das suas modalidades'}</p></div>
      <div class="acoes-linha no-print">
        <button class="btn sec" type="button" id="qr">QR Code do app</button>
        <button class="btn" type="button" id="novo">＋ Novo aluno</button>
      </div>
    </div>
    ${aulas.length ? '<input type="text" id="busca" class="busca-prof no-print" placeholder="Buscar aluno…" aria-label="Buscar aluno">' : ''}
    <div id="prof-aulas">${aulas.length ? aulas.map(cartaoAula).join('')
      : '<div class="card">' + vazio('Nenhuma modalidade foi atribuída a você ainda. Peça ao gestor para escolher suas aulas na aba Equipe.') + '</div>'}</div>

    ${cadastrados.length ? `
    <section class="card">
      <h2>Alunos que você cadastrou</h2>
      <ul class="lista-equipe">${cadastrados.map((c) => `
        <li><div><strong>${esc(c.cadastro_completo ? c.nome : c.email)}</strong>
          <small>${c.cadastro_completo ? esc(c.email || '') : 'aguardando o 1º acesso do aluno'} · ${fmtDate(c.created_at.slice(0, 10))}</small></div></li>`).join('')}</ul>
    </section>` : ''}`;

  el.querySelector('#qr').onclick = async () => (await import('./alunos.js')).abrirQrCode();
  el.querySelector('#novo').onclick = async () => (await import('./alunos.js')).novoAluno(navegar, { professor: true, aoCriar: recarregar });
  el.querySelector('#busca')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('.prof-aluno').forEach((li) => { li.hidden = !!q && !li.dataset.nome.includes(q); });
  });
}

function cartaoAula(aula) {
  const grupos = aula.turmas.length
    ? [...aula.turmas.map((t) => ({ titulo: t.nome, horarios: t.horarios, vagas: t.vagas, alunos: aula.alunos.filter((x) => x.turma_id === t.id) })),
       ...(aula.alunos.some((x) => !x.turma_id || !aula.turmas.some((t) => t.id === x.turma_id))
         ? [{ titulo: 'Sem turma definida', alunos: aula.alunos.filter((x) => !x.turma_id || !aula.turmas.some((t) => t.id === x.turma_id)) }] : [])]
    : [{ titulo: null, horarios: aula.horarios, vagas: aula.vagas, alunos: aula.alunos }];
  return `
    <section class="card prof-aula">
      <h2>${esc(aula.nome)}</h2>
      ${grupos.map((g) => {
        const ativos = g.alunos.filter((x) => x.status === 'ativa');
        const espera = g.alunos.filter((x) => x.status === 'espera');
        return `
        <div class="grupo-turma">
          ${g.titulo ? `<h3>${esc(g.titulo)} ${g.vagas !== undefined ? `<span class="badge ${ativos.length >= g.vagas ? 'erro' : 'ok'}">${ativos.length}/${g.vagas}</span>` : ''}</h3>` : `<p class="sub" style="margin:0 0 6px">${ativos.length}/${g.vagas} vagas ocupadas</p>`}
          ${horariosHTML(g.horarios)}
          ${ativos.length ? `<ul class="prof-lista">${ativos.map(linhaAluno).join('')}</ul>` : vazio('Nenhum aluno inscrito.')}
          ${espera.length ? `<h4>Lista de espera</h4><ol class="prof-lista">${espera.map(linhaAluno).join('')}</ol>` : ''}
        </div>`;
      }).join('')}
    </section>`;
}

function linhaAluno(x) {
  const anos = idade(x.nascimento);
  const zap = linkWhatsAppPara(x.telefone, `Olá, ${x.nome.split(' ')[0]}!`);
  return `
    <li class="prof-aluno" data-nome="${esc(x.nome.toLowerCase())}">
      <div><strong>${esc(x.nome)}</strong>
        <small>${[anos !== null ? `${anos} anos` : '', x.responsavel ? `resp.: ${esc(x.responsavel)}` : '', x.telefone ? esc(x.telefone) : ''].filter(Boolean).join(' · ') || '—'}</small></div>
      ${zap ? `<a class="icone-btn prof-zap" href="${esc(zap)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(x.nome)}">${ICONE_WHATSAPP}</a>` : ''}
    </li>`;
}
