# LAS — Raspa & Ganha

Jogo de raspadinhas digitais para recompensar colaboradores por objetivos de registos LAS. Projeto em **português de Portugal**, preparado para **Cloudflare Workers + Durable Objects SQLite** no plano gratuito. Sem servidor VPS e sem base de dados externa.

**Repositório:** https://github.com/ecbertw/raspadinha-las

## O que faz

- Prémios possíveis: Cartões Dá de **5 €, 10 €, 20 € e 50 €**.
- Podes personalizar as percentagens de cada prémio **em cada convite** (devem somar 100%).
- Percentagens predefinidas: 70% / 20% / 8% / 2%, alteráveis.
- Geras um **link único** para cada colaborador e envias tu mesmo.
- O participante raspa no telemóvel. O resultado é sorteado no **servidor**.
- O mesmo link nunca gera um segundo prémio; reabrir mostra o resultado anterior.
- Painel privado com convites, LAS registados manualmente, resultados, edição/anulação, entrega dos cartões e exportação CSV.
- A aplicação **não consulta os sistemas LAS** nem emite cartões automaticamente.

## Publicar na Cloudflare sem pagar alojamento

1. Acede a https://dash.cloudflare.com/ e escolhe o **plano Workers Free**.
2. Vai a **Workers & Pages > Create application > GitHub** (ou **Import a repository**). Autoriza a integração do GitHub.
3. Seleciona o repositório **ecbertw/raspadinha-las**, com a branch **main**.
4. O nome do Worker tem de ser **raspadinha-las** (igual ao nome em wrangler.jsonc).
5. Diretório raiz: raiz do repositório. **Build command: vazio** (se exigido, usa `npm test`). **Deploy command: `npx wrangler deploy`**.
6. Clica em **Save and Deploy**. O ficheiro wrangler.jsonc define automaticamente o armazenamento persistente SQLite, não precisas de criar uma base D1.
7. No Worker criado, abre **Settings > Variables and Secrets > Add Secret** e adiciona:
   - **ADMIN_PASSWORD** — uma palavra-passe tua de pelo menos 12 caracteres.
   - **APP_SECRET** — texto aleatório gerado por um gestor de palavras-passe, com pelo menos 32 caracteres (recomenda-se 64).
8. **Guarda e faz Deploy** após criar os dois segredos para os aplicar.
9. Abre o endereço `https://raspadinha-las.<teu-subdominio>.workers.dev/admin` e entra com ADMIN_PASSWORD. Se não existir o subdomínio, a Cloudflare pedir-te-á que escolhas um.
10. Testa um convite com probabilidades **0 / 0 / 0 / 100**. Raspa e confirma os 50 €. Reabre o mesmo link e confirma que não gera outro resultado.

**Importante:** Não coloques os segredos no GitHub, em screenshots, no ChatGPT ou em ficheiros publicados. **Guarda a APP_SECRET em segurança e não a alteres depois de emitir convites**: é a chave usada para recuperar os links guardados.

A Cloudflare publica automaticamente alterações posteriores à branch main se a integração Git estiver ativa. O armazenamento dos convites fica no Durable Object (nome estável: las-production-v1), independente da publicação do código.

## Como usar

- **Painel:** `/admin`
- **Link de participante:** `/j/<token-individual>`
- **Estado do servidor:** `/health`

No painel, preenche o nome, o número de registos LAS, a validade opcional e as probabilidades. Gera e copia o link. Após a participação, o valor fica no histórico até confirmares a entrega do cartão.

Um link é um **convite de portador**: qualquer pessoa que tenha o link pode usá-lo antes do seu destinatário. Partilha-o de forma privada. Se for necessário garantir a identidade do colaborador, adiciona autenticação/PIN antes de usar prémios reais.

## Execução e testes locais (opcional)

É necessário **Node.js 22.13+** e npm. Na pasta deste repositório:

~~~sh
npm install
cp .dev.vars.example .dev.vars
# Editar .dev.vars e introduzir dois valores de teste locais.
npm run start
npm test
~~~

O ambiente local usa uma base de dados separada da produção.

## Segurança e limites

- Interface protegida por palavra-passe, cookie HttpOnly e SameSite=Strict, proteção CSRF, bloqueio de tentativas sucessivas de autenticação.
- Sorteio feito no servidor com geração aleatória criptográfica e gravação transacional.
- Apenas convites ainda não utilizados podem ter probabilidades editadas.
- Armazenamento gratuito sujeito às quotas dos Workers e Durable Objects. Verifica os limites atuais na Cloudflare.
- Conserva exportações CSV regulares e define uma política de conservação de dados pessoais (RGPD).
- Antes de oferecer prémios reais, confirma o enquadramento legal e fiscal da campanha de incentivos/sorteio em Portugal e as condições dos Cartões Dá.
- Esta versão inicia um histórico novo na Cloudflare; não migra automaticamente o histórico de uma base local de versões anteriores.

## Estrutura

- `src/index.js` — API, sessões e armazenamento transacional SQLite do Durable Object.
- `src/core.js` — validação e probabilidades.
- `public/` — painel de administração, jogo, scripts e design responsive.
- `wrangler.jsonc` — configuração Cloudflare.
- `tests/` — testes da lógica e do percurso de atribuição.
- `.dev.vars.example` — modelo de variáveis locais, **sem credenciais reais**.
