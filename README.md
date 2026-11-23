# CEVISA — Spa Médico Adventista

App de controle de alunos e financeiro da academia. Banco de dados no **Supabase**; o front-end é HTML + JavaScript puro (sem build, sem `npm install`).

## Colocando para funcionar

### 1. Banco de dados
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra **SQL Editor**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
   (Cria tabelas, regras de segurança, funções, o bucket de fotos e as 4 aulas iniciais. Pode rodar de novo sem problemas.)

### 2. Primeiro gestor
1. Em **Authentication → Users → Add user**, crie o usuário com e-mail e senha (marque *Auto Confirm User*).
2. No **SQL Editor**, rode (trocando o e-mail):
   ```sql
   insert into public.gestores (user_id, nome)
   select id, 'Nome do gestor' from auth.users where email = 'gestor@exemplo.com';
   ```
   Para dar acesso a outros gestores, repita os dois passos.
3. Em **Authentication → Sign In / Providers → Email**, **desligue** **Allow new users to sign up**. As contas são criadas pelas funções abaixo: o aluno se cadastra pelo link (função `cadastro-aluno`) e a equipe/admins pela função `criar-usuario`.
4. Em **Authentication → URL Configuration**, deixe **Site URL** = endereço publicado (ex.: `https://cevisa.vercel.app`).

### Função "criar-usuario" (obrigatória para cadastrar alunos e admins)
Criar contas com senha exige a chave secreta do Supabase, que **não pode** ficar no site. Por isso existe uma função que roda no servidor do Supabase:
1. No Supabase, abra **Edge Functions → Deploy a new function → Via Editor**.
2. Nome da função: `criar-usuario` (exatamente assim).
3. Apague o código de exemplo e cole todo o conteúdo de `supabase/functions/criar-usuario/index.ts`.
4. Clique em **Deploy**. Não é preciso configurar nenhuma chave: o Supabase já fornece as variáveis que a função usa.

Se mudar o arquivo no futuro, abra a função no painel, cole o código novo e publique de novo.

### Função "cadastro-aluno" (obrigatória para o aluno se cadastrar pelo link)
1. Crie a função `cadastro-aluno` do mesmo jeito que a `criar-usuario`, colando `supabase/functions/cadastro-aluno/index.ts`.
2. Nos detalhes da função, **desligue** a opção **Verify JWT** / **Enforce JWT verification** (quem se cadastra ainda não tem login).
A conta é criada já confirmada (sem e-mail de confirmação) e com a ficha "a completar".

### Função "enviar-comprovante" (e-mail dos comprovantes)
O aluno envia o comprovante pelo app e ele chega **sempre** no sino e na ficha do aluno. Para receber também por **e-mail**, com o arquivo em anexo:
1. Crie uma conta grátis em [resend.com](https://resend.com) e gere uma **API Key**.
2. No Supabase, crie a função `enviar-comprovante` do mesmo jeito que a `criar-usuario`, colando `supabase/functions/enviar-comprovante/index.ts`.
3. Em **Edge Functions → Secrets**, adicione:
   - `RESEND_API_KEY` = a chave do Resend;
   - `COMPROVANTE_EMAIL` = o e-mail que recebe os comprovantes (vários, separados por vírgula);
   - opcional: `COMPROVANTE_REMETENTE` = remetente com domínio verificado no Resend (ex.: `CEVISA <comprovantes@seudominio.com.br>`). Sem isso, o Resend só entrega para o e-mail da própria conta do Resend.

Sem esses segredos, o envio continua funcionando no app, só não vai e-mail.

### Acesso dos alunos
1. Em **Alunos → Novo aluno** (ou no painel do professor), o app mostra o **link de cadastro** (`/#/cadastro`) com botões para enviar pelo **WhatsApp**, copiar, compartilhar ou mostrar o **QR Code**.
2. A pessoa abre o link, cria o **e-mail e a senha** (para crianças, o e-mail do responsável) e entra direto no formulário.
3. Ela é obrigada a **completar o cadastro** antes de usar o app. O cadastro é sempre do **responsável** (quem tem o login e paga). No bloco **"Quem vai fazer as aulas?"**, ela marca **"O próprio responsável"** ou informa o nome e a data de nascimento do dependente. Nas listas das turmas (equipe e professores) aparece o nome de quem faz as aulas. A **foto de perfil** de quem faz as aulas é obrigatória para concluir o cadastro; quem já tinha cadastro e ainda não tem foto vê a tela "Falta só a foto de perfil" no próximo login. A foto aparece pequena ao lado do nome (listas de alunos, turmas, painel do professor e do aluno) e amplia ao tocar. Fica num bucket **privado** (`perfis`): só o próprio aluno, a equipe e os professores veem. Na ficha, a equipe pode **trocar a foto**. O responsável também precisa aceitar o **Termo de uso e privacidade (LGPD)**, que fica registrado com data e versão na ficha (texto em `js/termo.js`, um rascunho para o jurídico revisar; ao mudar o texto, troque `TERMO_VERSAO`). Quem já tinha cadastro e ainda não aceitou vê o termo no próximo login. Para um segundo filho, cadastre outra ficha com o **mesmo e-mail** do responsável (*Cadastrar sem acesso ao app*): ela aparece automaticamente no app dele.
4. Esqueceu a senha? Na ficha do aluno, use **Gerar nova senha**.
5. Aluno sem e-mail: em **Novo aluno**, use *Cadastrar sem acesso ao app* (cadastro manual, como antes).
6. A ficha mostra se o aluno já tem **acesso ao app** ou se está **aguardando o 1º acesso**. Se você trocar o e-mail da ficha, o acesso antigo é desligado; use **Criar acesso ao app** na ficha.

### 3. Conectar o app
Em **Project Settings → API**, copie a **Project URL** e a chave **anon public** para `js/config.js`.
Nunca use a chave `service_role` no app.

No mesmo arquivo, preencha `WHATSAPP_NUMERO` (com DDI e DDD, só números, ex.: `5511912345678`). Ele é usado no balão do WhatsApp da tela inicial.

### 4. Abrir
O app usa módulos JavaScript, então precisa de um servidor local (não funciona abrindo o `index.html` direto):
- **VS Code:** extensão *Live Server* → botão direito em `index.html` → *Open with Live Server*; ou
- Terminal na pasta do projeto: `npx serve .`

Para publicar, envie a pasta inteira para qualquer hospedagem estática (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

## Como o app funciona

**Tela inicial (pública):** aulas com descrição, foto, turmas e preços mensal/semestral/anual e da diária. Visitantes **não** veem número de vagas. O botão **Entrar** abre o login em uma janela flutuante. Logado como gestor, os cartões ganham **Ver alunos**, **Turmas**, **Editar** e **Nova aula** (nome, descrição, preços, diária, vagas, foto, ordem, ocultar/exibir).

**Gestor, admins e professores:** quem foi cadastrado como gestor no passo 2 é o **gestor principal**. Na aba **Equipe**, ele adiciona ou remove admins e professores pelo e-mail; os admins também usam essa aba, mas só para adicionar, remover e escolher as aulas dos professores. Ao adicionar alguém, o app gera uma senha temporária; no primeiro acesso a pessoa cria a própria senha.
- **Admins** têm as mesmas permissões do gestor, mas não mexem na equipe.
- **Professores** só veem a aba **Meus alunos**: os alunos (e a lista de espera) das aulas atribuídas a eles, separados por turma, com idade, responsável, telefone e atalho para o WhatsApp. Também enviam o link de cadastro para alunos novos e abrem o **QR Code** do app. Não veem valores, pagamentos, relatórios nem as fichas completas. As aulas de cada professor são escolhidas ao criá-lo e podem ser trocadas no botão **Aulas** da aba Equipe. Depois que o professor cadastra um aluno, a recepção faz a inscrição na aula e na turma.

**Atalho no celular:** ao adicionar o site à tela inicial, o nome sugerido é **CEVISA FITNESS** e o ícone é o símbolo da logo (`assets/icon-*.png`, `assets/apple-touch-icon.png` e `manifest.webmanifest`).

**Horários:** cada aula tem um campo de horários (um por linha), editado pelo gestor em **Editar**. Aparecem na tela inicial e no painel do aluno.

**Grupo de WhatsApp da aula:** em **Editar** (no cartão da aula), o campo **Link do grupo de WhatsApp** (ex.: `https://chat.whatsapp.com/...`). Uma turma pode ter um grupo próprio, no campo **Grupo de WhatsApp da turma** (em **Turmas**); se ficar vazio, vale o grupo da aula. Quem tem matrícula ativa na aula recebe, ao abrir o painel, uma janela com o botão **Entrar no grupo**. A janela volta a aparecer a cada visita até o aluno tocar no botão. O cartão da aula no painel também tem o botão **Grupo da turma no WhatsApp**. Se o link for trocado, todos os inscritos recebem a janela de novo. O link não aparece na tela pública nem para quem está na lista de espera.

**Turmas:** cada aula pode ter várias turmas, em **Turmas** no cartão da aula. Cada turma tem nome, horários, características (nível, faixa etária, professor…) e vagas próprias. Os alunos veem as turmas no cartão; a equipe vê a ocupação de cada uma. Aula sem turmas continua usando as vagas e os horários da própria aula. Na ficha do aluno, **Trocar turma** muda o aluno de turma.

**Inscrição pelo app:** no cartão da aula, o aluno vê **Fazer inscrição** enquanto houver vaga. Quando as vagas acabam, o botão fica **amarelo** e mostra **Fila de espera**. Ao pedir, o aluno escolhe a turma (as sem vaga aparecem em cinza e não podem ser escolhidas) e o plano. A equipe recebe o pedido no sino e conclui a inscrição na ficha; a cobrança aparece na hora no painel do aluno.

**Painel do aluno:** depois do login, o aluno vê as aulas contratadas com horários, o valor de cada plano, o **total a pagar** (mensalidades que vencem nos próximos 30 dias ou já vencidas) e a data de vencimento. Tem os botões **Enviar comprovante** (foto ou PDF; a equipe recebe no sino, em banner, na ficha do aluno e por e-mail) e **Já paguei**: este avisa o gestor, que recebe na hora um **banner verde** no app; tocando nele, abre a ficha do aluno. O aviso some quando o gestor registra o pagamento. O aluno não tem nenhum privilégio de gestor: só enxerga os próprios dados.

**WhatsApp:** visitantes (antes do login) veem um balão fixo no canto da tela que abre uma conversa no WhatsApp.

**Alunos:** busca e filtros (ativos, desativados, plano vencido, lista de espera). Clicando no aluno abre a ficha: botão **Enviar mensagem** (abre o WhatsApp do aluno pelo telefone cadastrado), dados pessoais, aulas e planos (início, pago até, meses trancados), histórico de pagamentos, ativar/desativar, inscrever em aula.

**Vagas e lista de espera:** se a turma está cheia, a inscrição entra na lista de espera, por ordem de reserva. Quando uma vaga abre (matrícula encerrada ou vagas aumentadas), o primeiro da fila é promovido automaticamente, uma cobrança é gerada e o gestor recebe uma notificação.

**Questionário de saúde (PAR-Q):** obrigatório no cadastro. São 7 perguntas de sim/não sobre quem vai fazer as aulas, mais uma declaração de veracidade. Quem já tinha cadastro responde no próximo acesso, e o app só libera depois disso. Uma resposta “sim” não impede o cadastro: o app recomenda avaliação médica e atestado de liberação, e a equipe recebe um aviso no sino. Na ficha do aluno, a linha **Questionário de saúde (PAR-Q)** mostra a situação (**Apto** ou **N respostas “sim”**), com o link **ver respostas**.

**Vínculo com o Cevisa (preço):** no cadastro, a pessoa marca se é **Externo** (preço normal), **Funcionário** (aulas sem custo) ou **Prestador** (plano mensal de R$ 100,00 em todas as aulas; semestral e anual com preço normal). Funcionário e prestador geram um aviso no sino e só valem depois que a equipe **confirma na ficha** (a equipe também pode mudar o vínculo por lá ou ao editar o cadastro). Se as aulas forem de um **dependente**, vale sempre o preço normal. Ao confirmar ou mudar, as cobranças pendentes são recalculadas na hora. Para funcionário, a cobrança de R$ 0,00 é quitada automaticamente ("Isento (funcionário)") e o plano se renova sozinho.

**Pagar com Pix:** no painel do aluno, o botão **Pagar com Pix** gera o **Pix copia e cola** e o **QR Code** já com o valor a pagar (padrão do Banco Central, sem integração com banco), e mostra a chave como alternativa. Chave, nome e cidade do recebedor ficam em `js/config.js` (`PIX_CHAVE`, `PIX_NOME`, `PIX_CIDADE`).

**Cobrar no WhatsApp:** em **Cobranças** e no histórico de pagamentos da ficha, cada cobrança pendente tem o botão verde **Cobrar**, que abre o WhatsApp do responsável com a mensagem pronta (aula, valor, vencimento, link do app e chave Pix).

**Pagamentos e vencimentos:** cada plano gera uma cobrança. Ao **registrar o pagamento**, o plano vale por mais 1, 6 ou 12 meses (`data_fim` = "pago até"). Planos que vencem em até 7 dias (ou já venceram) geram uma cobrança pendente e uma notificação no sino. A verificação roda **automaticamente todo dia às 06:00 e às 12:00** (pg_cron, ativado pelo `schema.sql`), e também quando o gestor abre o app. Para conferir no SQL Editor: `select jobname, schedule, active from cron.job;`.

**Trancar matrícula (semestral e anual):** o **aluno** pede pelo app, no cartão da aula (**Trancar mês**): a opção é sempre o **próximo mês**, em qualquer dia. A equipe recebe o pedido no sino e **aprova ou recusa** na ficha do aluno; só ao aprovar o mês fica trancado e é acrescentado ao final do plano. O aluno acompanha a situação no cartão. A equipe também pode trancar direto pela ficha (**Trancar mês**, para meses que ainda não começaram) e desfazer enquanto o mês não começou.

**Cobranças:** pendentes, atrasadas, pagas e diárias, com busca e registro de pagamento. **Lançar diária** registra um pagamento avulso: valor, método, data e, se quiser, a modalidade.
- **Lançar mensal:** o aluno do plano mensal paga vários meses adiantado (meses do ano atual, em sequência).
- **Lançar semestral / Lançar anual:** quita o próximo período (6 ou 12 meses) do aluno e registra **em quantas vezes foi dividido no cartão**. Nos relatórios, o valor entra dividido: uma parcela por mês a partir da data do pagamento (os centavos da divisão ficam na 1ª parcela).
- **Comprovante da equipe:** cada cobrança **paga** tem um botão **+** para anexar uma imagem do comprovante (foto ou print, reduzida antes de enviar). O botão **📎 Ver** abre o comprovante; ele também aparece em **Comprovantes**, na ficha do aluno.

**Família (responsável com dependentes):** cada pessoa que faz aula tem a **própria ficha** (foto, PAR-Q, turma, desconto), todas ligadas ao mesmo acesso do responsável. O responsável adiciona dependentes no app (**Minha família → Adicionar dependente**: nome, nascimento, sexo e grau de parentesco; em seguida o app pede a foto e o PAR-Q do dependente). A equipe também pode, pela ficha (**Família → Adicionar dependente**). A ficha do dependente copia os contatos e o aceite do termo do responsável e aponta para a ficha principal (`responsavel_id`); as fichas com o mesmo acesso ou e-mail também contam como família. Cobranças, WhatsApp e "Já paguei" vão para o responsável: o aviso de pagamento é um só, com o total da família, e **Confirmar pagamento** lista e dá baixa nas aulas de todos de uma vez. Dependente paga o preço normal (o vínculo de funcionário/prestador vale só para o próprio). Se o e-mail do responsável mudar, atualize também nas fichas dos dependentes. O cadastro inicial (primeiro acesso) é só do responsável: dependentes entram depois, por "Adicionar dependente".

**Idade mínima:** cada aula pode ter uma idade mínima (Editar aula → "Idade mínima"). Musculação e hidroginástica começam com 14 anos. Quem ainda não tem a idade (pela data de nascimento de quem faz as aulas) não vê a opção de se inscrever no app nem na tela "Inscrever" da ficha, e o banco também recusa a inscrição. Sem data de nascimento, não há bloqueio.

**Reserva de vaga:** quando o aluno se inscreve pelo app, a vaga fica reservada na hora (matrícula + cobrança) e o gestor recebe um aviso no sino. Enquanto nenhum pagamento daquela matrícula for registrado, a ficha, o painel do aluno e a lista de alunos da aula mostram **Reserva de vaga**; ao registrar o pagamento, vira **Ativa** (e o link do grupo de WhatsApp aparece para o aluno). Para desistir de uma reserva, use **Encerrar** na ficha. Sem vaga, o aluno entra direto na lista de espera.

**Inscrever com desconto:** no pedido de inscrição feito pelo aluno (ficha → **Pedidos de inscrição pelo app**), o botão **Inscrever com desconto** pede o **novo valor** e o **motivo**. O valor vale para **todas as cobranças** daquela aula enquanto durar; a ficha mostra o desconto e o motivo, e o botão **Desconto** de cada aula permite mudar ou retirar (a cobrança em aberto passa a usar o novo valor). Desconto para R$ 0,00 quita as cobranças automaticamente ("Isento (desconto)").

**Anúncios (oculto no momento — para reativar, troque `ANUNCIOS_ATIVOS` para `true` em `js/app.js`):** aba só da equipe de gestão (gestor e admins). Um anúncio tem título (opcional) e mensagem, e pode:
- aparecer **agora** ou ser **programado** para uma data e hora;
- aparecer **uma vez** ou **repetir** todo dia, toda semana ou todo mês, no mesmo horário do início;
- ter **data de expiração**: a partir desse dia ele some sozinho.

Alunos e professores veem o anúncio num **balão flutuante** ao abrir o app. O botão **Entendi** só libera depois de 5 segundos, com a contagem no próprio botão. Cada pessoa vê o anúncio uma vez por ocorrência; um anúncio diário volta no dia seguinte. A lista mostra quantas confirmações de leitura cada anúncio teve, com os botões **Prévia**, **Editar**, **Pausar/Reativar** e **Excluir**.

**Relatórios:** por mês, em duas sub-abas. **Geral** mostra novos alunos, planos contratados, mensalidades recebidas, diárias recebidas, total recebido, a receber, alunos em débito e as listas de pagamentos e diárias. **Modalidades** mostra os mesmos números separados por aula. Tem botão de imprimir.

## Decisões que tomei (fáceis de mudar)
- **Preços semestral e anual são o valor total do plano**, com parcelamento de até **6x no semestral** e até **10x no anual** (o cartão da aula mostra o valor de cada parcela, ex.: "10x R$ 144,00"). Planos mensais geram uma cobrança por mês.
- **Preços e vagas iniciais estão em branco/exemplo.** As 4 aulas entram sem preço (aparece "Consulte") e com vagas de exemplo. Ajuste na tela de Aulas.
- **Ativar/desativar é sempre manual**, como você pediu. Ao registrar um pagamento de aluno desativado, o app só pergunta se quer ativá-lo.
- **Aluno desativado continua ocupando vaga** até a matrícula ser encerrada.
- **"Em débito"** no relatório = cobrança pendente com vencimento dentro do mês escolhido e já vencida.
- Quem fica na fila não gera cobrança até ser promovido.

## Estrutura
```
index.html            página única
assets/logo.png       logo da instituição
css/styles.css        visual (cores da logo)
js/app.js             login, cabeçalho e rotas
js/home.js            aulas e preços (+ edição)
js/alunos.js          lista, ficha, inscrição, trancamento
js/financeiro.js      cobranças e registro de pagamento
js/relatorios.js      relatório mensal
js/notificacoes.js    sino de notificações
supabase/schema.sql   banco, segurança e regras de negócio
```

As regras de negócio (vagas, fila, pagamento, trancamento, relatório) ficam no banco, em funções SQL, e as permissões são garantidas por RLS: só gestores leem ou alteram dados de alunos e finanças.
