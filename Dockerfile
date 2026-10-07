# cs2parser exige Node >= 22 (require de ESM + WASM)
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY .env.example ./

ENV NODE_ENV=production
ENV PORT=5055
# 0 = sem trajetória contínua (estável no Free). Kills ainda trazem posições.
# Para calor de movimento depois: FRAME_INTERVAL_SEC=2 e plano com mais RAM.
ENV FRAME_INTERVAL_SEC=0
ENV MAX_FRAMES=600

EXPOSE 5055

CMD ["node", "--max-old-space-size=400", "src/server.js"]
