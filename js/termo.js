// Termo de uso e privacidade (LGPD) aceito pelo responsável no cadastro.
// IMPORTANTE: rascunho para revisão do jurídico da instituição. Ao mudar o texto de forma relevante,
// troque TERMO_VERSAO — o app registra a versão aceita por cada responsável.
import { abrirModal } from './ui.js';

export const TERMO_VERSAO = '2026-11';

export const TERMO_HTML = `
  <div class="termo-texto">
    <p><strong>Spa Médico Adventista Cevisa</strong> — Termo de uso do aplicativo e de tratamento de dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD).</p>

    <h3>1. Quem é o responsável pelos dados</h3>
    <p>O Spa Médico Adventista Cevisa (CNPJ 21.636.951/0002-02) é o controlador dos dados informados neste aplicativo.</p>

    <h3>2. Quais dados coletamos</h3>
    <ul>
      <li>Do responsável (titular do cadastro): nome, telefone/WhatsApp, e-mail, CPF, data de nascimento e endereço.</li>
      <li>De quem faz as aulas (o próprio responsável ou um dependente): nome, data de nascimento e <strong>foto de perfil</strong>.</li>
      <li>De quem faz as aulas: respostas do <strong>questionário de saúde (PAR-Q)</strong>, dado sensível usado só para a segurança na prática de atividade física.</li>
      <li>Dados das aulas e financeiros: modalidades, turmas, planos, cobranças, pagamentos e comprovantes enviados.</li>
    </ul>

    <h3>3. Para que usamos</h3>
    <ul>
      <li>Fazer a inscrição e organizar as turmas e a lista de espera.</li>
      <li>Identificar o aluno na recepção e nas aulas (por isso a foto de perfil).</li>
      <li>Avaliar, pelo PAR-Q, se é preciso liberação médica antes das aulas (visto apenas pela equipe do Cevisa).</li>
      <li>Gerar cobranças, registrar pagamentos e enviar avisos de vencimento.</li>
      <li>Entrar em contato pelo telefone, WhatsApp ou e-mail sobre aulas, horários e pagamentos.</li>
    </ul>

    <h3>4. Foto de perfil e uso de imagem</h3>
    <p>A foto de perfil é usada <strong>apenas para identificação interna</strong>. Ela fica guardada de forma privada e só pode ser vista pelo próprio responsável, pela equipe da recepção e pelos professores. <strong>Ela não será publicada</strong> em site, redes sociais ou material de divulgação sem uma autorização específica e separada.</p>

    <h3>5. Crianças e adolescentes</h3>
    <p>Quando as aulas forem de uma criança ou adolescente, o responsável declara ser seu <strong>pai, mãe ou responsável legal</strong> e autoriza, em nome dele, o tratamento dos dados e da foto para as finalidades acima, no melhor interesse da criança (art. 14 da LGPD).</p>

    <h3>6. Com quem os dados são compartilhados</h3>
    <p>Não vendemos nem cedemos seus dados. Eles ficam armazenados em serviços de tecnologia contratados para o funcionamento do aplicativo (hospedagem e banco de dados), que só os tratam conforme nossas instruções. Podemos compartilhá-los quando exigido por lei ou por autoridade competente.</p>

    <h3>7. Por quanto tempo</h3>
    <p>Mantemos os dados enquanto houver vínculo com o Cevisa e, depois, pelo prazo necessário para cumprir obrigações legais, fiscais e contábeis. A foto de perfil pode ser excluída a pedido quando o aluno deixar de frequentar as aulas.</p>

    <h3>8. Seus direitos</h3>
    <p>Você pode, a qualquer momento, pedir para confirmar, acessar, corrigir, atualizar ou excluir seus dados e os do seu dependente, além de revogar este consentimento, falando com a recepção do Cevisa. A revogação pode impedir o uso do aplicativo.</p>

    <h3>9. Segurança</h3>
    <p>O acesso ao aplicativo é feito com e-mail e senha pessoal. Cada responsável vê apenas os próprios dados. Não compartilhe sua senha.</p>
  </div>`;

/** Abre o termo numa janela para leitura. */
export function abrirTermo() {
  abrirModal({ titulo: 'Termo de uso e privacidade', largura: 620, corpo: TERMO_HTML });
}

/** Caixa de aceite para formulários. */
export const caixaTermo = () => `
  <label class="check aceite-termo">
    <input type="checkbox" name="aceite_termo">
    <span>Li e aceito o <a href="#" data-ver-termo>Termo de uso e privacidade</a>, inclusive o uso da foto de perfil para identificação interna e, se for o caso, autorizo como responsável legal o tratamento dos dados do meu dependente. *</span>
  </label>`;
