// Questionário PAR-Q (Physical Activity Readiness Questionnaire), obrigatório no cadastro.
// Respondido pelo responsável sobre QUEM VAI FAZER AS AULAS. "Sim" em alguma pergunta
// não impede o cadastro: o app recomenda avaliação médica e avisa a equipe no sino.
import { esc, fmtDate, abrirModal } from './ui.js';

export const PARQ_PERGUNTAS = [
  'Algum médico já disse que você possui algum problema de coração e que só deveria realizar atividade física supervisionada por profissionais de saúde?',
  'Você sente dores no peito quando pratica atividade física?',
  'No último mês, você sentiu dores no peito quando praticou atividade física?',
  'Você apresenta desequilíbrio devido a tontura e/ou perda de consciência?',
  'Você possui algum problema ósseo ou articular que poderia ser piorado pela atividade física?',
  'Você toma atualmente algum medicamento para pressão arterial e/ou problema de coração?',
  'Sabe de alguma outra razão pela qual você não deve praticar atividade física?',
];

const AVISO_SIM = 'Você respondeu “sim” em pelo menos uma pergunta. Antes de começar as aulas, procure um médico para uma avaliação e traga o atestado de liberação para a atividade física. A recepção vai orientar você.';

/** Bloco do formulário. quem: nome de quem vai fazer as aulas (se for um dependente). */
export function camposParq() {
  return `
    <fieldset class="parq" id="parq">
      <legend>Questionário de saúde (PAR-Q) *</legend>
      <p class="sub" style="margin:0 0 10px">Obrigatório para quem vai praticar atividade física. Responda sobre <strong>quem vai fazer as aulas</strong> (se for um dependente, responda por ele).</p>
      <ol class="parq-lista">${PARQ_PERGUNTAS.map((p, i) => `
        <li>
          <span>${esc(p)}</span>
          <div class="parq-opcoes" role="radiogroup" aria-label="Pergunta ${i + 1}">
            <label><input type="radio" name="parq_q${i + 1}" value="sim"> Sim</label>
            <label><input type="radio" name="parq_q${i + 1}" value="nao"> Não</label>
          </div>
        </li>`).join('')}</ol>
      <div class="parq-aviso aviso alerta" hidden>${esc(AVISO_SIM)}</div>
      <label class="check parq-declaro"><input type="checkbox" name="parq_declaro">
        <span>Declaro que as respostas acima são verdadeiras e que estou ciente dos riscos da prática de atividade física.</span></label>
    </fieldset>`;
}

/** Mostra o aviso de avaliação médica quando houver "sim". */
export function ligarParq(form) {
  const aviso = form.querySelector('.parq-aviso');
  form.querySelector('#parq')?.addEventListener('change', () => {
    aviso.hidden = !form.querySelector('#parq input[value=sim]:checked');
  });
}

/** Lê as respostas ({q1: bool, …}) ou lança erro em português. */
export function lerParq(form) {
  const r = {};
  for (let i = 1; i <= PARQ_PERGUNTAS.length; i++) {
    const v = form.querySelector(`[name=parq_q${i}]:checked`)?.value;
    if (!v) throw new Error(`Responda a pergunta ${i} do questionário de saúde (PAR-Q).`);
    r[`q${i}`] = v === 'sim';
  }
  if (!form.parq_declaro.checked) throw new Error('Marque a declaração do questionário de saúde (PAR-Q).');
  return r;
}

const qtdSim = (parq) => Object.values(parq || {}).filter((v) => v === true).length;

/** Linha da ficha (equipe). */
export function parqResumoHTML(aluno) {
  if (!aluno.parq_em) {
    return aluno.user_id ? '<span class="badge alerta">Pendente</span> será pedido no próximo acesso' : '<span class="badge cinza">Sem acesso ao app</span> aplicar o questionário em papel';
  }
  const sim = qtdSim(aluno.parq);
  return `${sim ? `<span class="badge erro">${sim} resposta${sim > 1 ? 's' : ''} “sim”</span> pedir liberação médica` : '<span class="badge ok">Apto</span> todas “não”'}
    · ${fmtDate(aluno.parq_em.slice(0, 10))} <button class="link-btn no-print" type="button" data-ver-parq>ver respostas</button>`;
}

export function abrirRespostasParq(aluno, nome) {
  const sim = qtdSim(aluno.parq);
  abrirModal({
    titulo: 'Questionário PAR-Q',
    largura: 560,
    corpo: `
      <p class="sub" style="margin:0 0 12px"><strong>${esc(nome)}</strong> · respondido em ${fmtDate(aluno.parq_em.slice(0, 10))}</p>
      ${sim ? '<div class="aviso alerta">Há resposta “sim”: recomende avaliação médica e peça o atestado de liberação antes das aulas.</div>' : ''}
      <ol class="parq-lista parq-respostas">${PARQ_PERGUNTAS.map((p, i) => {
        const v = aluno.parq?.[`q${i + 1}`];
        return `<li><span>${esc(p)}</span><strong class="${v ? 'parq-sim' : ''}">${v ? 'Sim' : 'Não'}</strong></li>`;
      }).join('')}</ol>`,
  });
}
