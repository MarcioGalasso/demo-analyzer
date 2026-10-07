# cs2parser exige Node >= 22 (require de ESM + WASM)
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY .env.example ./

ENV NODE_ENV=production
ENV PORT=5055
# 1 frame/s para mapa de calor (Free pode usar mais RAM — se 500, use 2)
ENV FRAME_INTERVAL_SEC=1
ENV MAX_FRAMES=2500
ENV MAX_UPLOAD_MB=800

EXPOSE 5055

CMD ["node", "--max-old-space-size=400", "src/server.js"]
