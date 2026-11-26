# Manual de instalação — Marido de Aluguel (site + central + WhatsApp)

Este pacote publica o site e a central de atendimento **no mesmo lugar**, tudo ligado ao banco D1 **marido-aluguel-connect-db** (ID já configurado em `wrangler.jsonc`).

> **Importante:** este pacote é publicado como **Worker** (não como projeto Pages). Seu projeto `divine-firefly-ac29` e o banco D1 **não são apagados nem alterados**. O novo endereço será `https://marido-aluguel.SEU-USUARIO.workers.dev`. Quando tudo estiver funcionando, você decide se quer apontar seu domínio para ele.

## Parte 1 — Publicar (sem WhatsApp ainda)
1. Instale o **Node.js** (versão LTS) em https://nodejs.org
2. Descompacte o ZIP. Abra o **Terminal** (Windows: "Prompt de Comando" ou PowerShell) **dentro da pasta** `maridoapp`.
3. Rode, um de cada vez:
   - `npm install`
   - `npx wrangler login` (abre o navegador; autorize sua conta Cloudflare)
   - `npm run db:schema` (cria as tabelas no seu D1 existente; é seguro repetir)
   - `npm run deploy`
4. No final aparece o endereço `https://marido-aluguel....workers.dev`. Abra-o: é o seu site.
5. Abra `ENDEREÇO/#painel`. Na **primeira vez**, a tela pede para **criar o usuário e a senha do ADMIN-01** (mínimo 8 caracteres, com letras e números). Guarde essa senha.

**Teste rápido:** abra o site em outra aba/celular, clique no chat e mande uma mensagem. Ela aparece em **Atendimento** no painel (a tela atualiza sozinha a cada poucos segundos). Clique na conversa → **Assumir** → responda. O cliente vê a resposta no chat.

## Parte 2 — Ligar o WhatsApp (API oficial da Meta)
Só você pode fazer esta parte (precisa das suas credenciais). Em https://developers.facebook.com → seu app → **WhatsApp**:
1. **API Setup**: copie o **Phone number ID** → será o `WA_PHONE_ID`.
2. **Token permanente**: em business.facebook.com → Configurações → Usuários do sistema → crie um usuário do sistema, atribua o app e gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management` → será o `WA_TOKEN`. (O token temporário de 24h serve só para teste.)
3. **Configurações do app → Básico → Chave secreta do app** → será o `WA_APP_SECRET`.
4. Invente um texto secreto qualquer (ex.: `casa-do-jean-2026-xyz`) → será o `WA_VERIFY_TOKEN`.
5. No terminal, para cada item rode o comando e cole o valor quando pedir:
   - `npx wrangler secret put WA_PHONE_ID`
   - `npx wrangler secret put WA_TOKEN`
   - `npx wrangler secret put WA_APP_SECRET`
   - `npx wrangler secret put WA_VERIFY_TOKEN`
6. Na Meta: **WhatsApp → Configuration → Webhook → Edit**:
   - **Callback URL:** `https://marido-aluguel.SEU-USUARIO.workers.dev/api/whatsapp`
   - **Verify token:** o mesmo `WA_VERIFY_TOKEN`
   - Clique em **Verify and save**, depois em **Manage** e assine o campo **messages**.
7. Mande um WhatsApp para o número da API: a conversa aparece no painel com o canal **WhatsApp**. Quando o Jean assume e responde no painel, a resposta sai pelo WhatsApp.

**Regra da Meta:** respostas livres só são aceitas até **24 horas** depois da última mensagem do cliente. Depois disso a Meta exige um *modelo de mensagem aprovado* (não incluído nesta versão). Se o envio for recusado, o painel avisa.

## Segurança
- Senhas ficam só no servidor (PBKDF2); o painel usa cookie protegido; as rotas administrativas exigem login; 5 senhas erradas bloqueiam por 5 minutos; o webhook confere a assinatura da Meta.
- Nenhuma senha ou chave está no código. Use sempre `wrangler secret put`.
- CORS: por padrão só o próprio site acessa a API. Para liberar outro domínio, preencha `ALLOWED_ORIGINS` em `wrangler.jsonc` (separe por vírgula) e rode `npm run deploy`.

## Testar no seu computador (opcional)
Copie `.dev.vars.example` para `.dev.vars`, rode `npx wrangler d1 execute marido-aluguel-connect-db --local --file=schema.sql` e depois `npm run dev`.

## Problemas comuns
- **Erro de login no `wrangler`:** rode `npx wrangler login` de novo.
- **"no such table":** rode `npm run db:schema`.
- **Webhook não verifica:** confira se o `WA_VERIFY_TOKEN` é idêntico nos dois lados e se já fez `npm run deploy` depois de criar os segredos.
- **Esqueci a senha do ADMIN-01:** no Cloudflare → D1 → Console, rode `DELETE FROM docs WHERE kind='user'; DELETE FROM sessions;` e abra `/#painel` para criar o acesso de novo (os clientes e conversas não são apagados).
