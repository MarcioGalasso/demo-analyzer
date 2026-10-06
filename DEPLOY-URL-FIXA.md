# Deploy do Demo Analyzer com URL FIXA (sem PC, sem ngrok)

O site na Locaweb chama este serviço. A URL fica estável, tipo:
`https://mousetrap-demo-analyzer.onrender.com`

---

## Opção recomendada: Render (grátis + URL fixa)

### 1) Conta
1. Crie conta em https://render.com (GitHub)
2. Coloque a pasta `demo-analyzer` num repositório GitHub
   - Pode ser um repo só dela, ou o repo inteiro do mousetrap
   - Se for o repo inteiro, no deploy use **Root Directory** = `demo-analyzer`

### 2) Criar o serviço
1. Render → **New** → **Web Service**
2. Conecte o repositório
3. Configurações:
   - **Name:** `mousetrap-demo-analyzer`
   - **Root Directory:** `demo-analyzer` (se o repo for o projeto todo)
   - **Runtime:** Docker (usa o Dockerfile)  
     *ou* Node: Build `npm install` / Start `node src/server.js`
   - **Instance type:** Free
4. **Environment Variables:**
   - `DEMO_ANALYZER_SECRET` = `mousetrap-demo-secret` (ou outra senha forte)
   - (PORT o Render define sozinho — não precisa criar)
5. Create Web Service → espere o deploy (2–5 min)

### 3) Pegar a URL fixa
No painel do serviço aparece algo como:

`https://mousetrap-demo-analyzer.onrender.com`

Teste no navegador:

`https://SUA-URL.onrender.com/health`

Deve retornar: `{"ok":true,"service":"mousetrap-demo-analyzer"}`

### 4) Ligar no site (Locaweb)
Admin → **Configurações** → Análise de Demos:

- **URL do Demo Analyzer:** `https://mousetrap-demo-analyzer.onrender.com`  
  (sem barra no final)
- **Secret:** o mesmo de `DEMO_ANALYZER_SECRET`
- **OpenAI API Key:** sua chave

Salvar → em **Análise Demos** o pill deve ficar **Parser: online**.

---

## Observação do plano Free do Render

- A URL **não muda**
- Depois de ~15 min sem uso o serviço “dorme”
- A **primeira** análise após dormir pode demorar ~30–60s (acordar)
- Se quiser sempre quente: plano pago do Render, Railway, ou VPS

---

## Alternativa: Railway

1. https://railway.app → New Project → Deploy from GitHub
2. Root: `demo-analyzer`
3. Variável `DEMO_ANALYZER_SECRET`
4. Generate Domain → URL fixa `*.up.railway.app`
5. Colar no admin igual acima

---

## Fluxo final (usuário do painel)

1. Sobe só o `.dem` na Locaweb  
2. Locaweb chama a URL fixa do Render  
3. Parser devolve os dados  
4. PHP calcula métricas + IA  

Nada roda no seu PC.
