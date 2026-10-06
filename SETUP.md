# Demo Analyzer (CS2) — MouseTrap

## Arquitetura (decisão)

| Camada | Tech | Onde roda |
|---|---|---|
| Painel / métricas / chat IA | **PHP + MySQL** | Locaweb (já existente) |
| Parse `.dem` | **Node.js + `cs2parser`** | PC local / VPS / Railway (Locaweb compartilhada **não** roda Node) |
| Relatório + perguntas | **OpenAI API** | Chamada HTTP do PHP |

Fluxo:
1. Admin sobe `.dem` **ou** JSON já parseado
2. Se `.dem` → PHP chama `POST /parse` no worker Node
3. PHP calcula métricas (5v4, 4v5, pistol, opening, trades, economia)
4. OpenAI gera relatório automático
5. Chat interativo usa o JSON da demo

## 1) Banco

No phpMyAdmin, rode o arquivo:

`database/demos.sql`

## 2) Worker Node (cs2parser)

```bash
cd demo-analyzer
copy .env.example .env
npm install
npm start
```

Sobe em `http://127.0.0.1:5055`.

CLI local (gera JSON sem API):

```bash
npm run parse -- caminho\\para\\partida.dem
```

## 3) Painel

1. Configurações → cole **OpenAI API Key** + URL/secret do analyzer
2. Menu **Análise Demos** → Nova análise
3. Informe os nicks do time (iguais aos da demo)
4. Envie `.dem` (analyzer ligado) **ou** `dados_partida.json`

## 4) Produção (Locaweb)

- Suba os arquivos PHP normalmente
- Rode o SQL
- O worker Node precisa ficar **acessível pela Locaweb** (URL pública HTTPS do VPS/Railway), não `127.0.0.1`
- Alternativa: parse local → importar só o JSON no painel

## Métricas

- Win rate 5v4 / 4v5
- Pistol CT / TR (rounds 1 e 13)
- Opening kill rate
- Traded deaths (≤ 5s)
- Economia Eco / Forçado / Armado / Pistol
