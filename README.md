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
3. Recomendado: em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**. Mesmo que alguém criasse conta, sem estar em `gestores` não consegue ver nem alterar nada, mas não há motivo para deixar aberto.

### 3. Conectar o app
Em **Project Settings → API**, copie a **Project URL** e a chave **anon public** para `js/config.js`.
Nunca use a chave `service_role` no app.

### 4. Abrir
O app usa módulos JavaScript, então precisa de um servidor local (não funciona abrindo o `index.html` direto):
- **VS Code:** extensão *Live Server* → botão direito em `index.html` → *Open with Live Server*; ou
- Terminal na pasta do projeto: `npx serve .`

Para publicar, envie a pasta inteira para qualquer hospedagem estática (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

## Como o app funciona

**Tela inicial (pública):** aulas com descrição, foto e preços mensal/semestral/anual. Visitantes **não** veem número de vagas. O botão **Entrar** abre o login em uma janela flutuante. Logado como gestor, os cartões ganham **Editar**, **Ver turma** e **Nova aula** (nome, descrição, preços, vagas, foto, ordem, ocultar/exibir).

**Alunos:** busca e filtros (ativos, desativados, plano vencido, lista de espera). Clicando no aluno abre a ficha: dados pessoais, aulas e planos (início, pago até, meses trancados), histórico de pagamentos, ativar/desativar, inscrever em aula.

**Vagas e lista de espera:** se a turma está cheia, a inscrição entra na lista de espera, por ordem de reserva. Quando uma vaga abre (matrícula encerrada ou vagas aumentadas), o primeiro da fila é promovido automaticamente, uma cobrança é gerada e o gestor recebe uma notificação.

**Pagamentos e vencimentos:** cada plano gera uma cobrança. Ao **registrar o pagamento**, o plano vale por mais 1, 6 ou 12 meses (`data_fim` = "pago até"). Planos que vencem em até 7 dias (ou já venceram) geram uma cobrança pendente e uma notificação no sino. A verificação roda quando o gestor abre o app e a cada 5 minutos enquanto está aberto. Para rodar também sem ninguém logado, veja o trecho de `pg_cron` no fim do `schema.sql`.

**Trancar matrícula (semestral e anual):** só para um mês que ainda não começou e que esteja dentro do período já pago. O mês trancado vai para o final: o plano ganha 1 mês. É possível desfazer enquanto o mês não começou.

**Cobranças:** pendentes, atrasadas e pagas, com busca e registro de pagamento.

**Relatórios:** por mês, novos alunos, planos contratados, recebido, a receber, alunos em débito e lista de pagamentos. Tem botão de imprimir.

## Decisões que tomei (fáceis de mudar)
- **Preços semestral e anual são o valor total do plano**, pago de uma vez (o app mostra também o equivalente por mês). Planos mensais geram uma cobrança por mês.
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
