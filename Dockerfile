# cs2parser exige Node >= 22 (require de ESM + WASM)
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY .env.example ./

ENV NODE_ENV=production
ENV PORT=5055
# 1 frame/s — bom equilíbrio tamanho x view 2D
ENV FRAME_INTERVAL_SEC=1

EXPOSE 5055

# Limite de heap um pouco maior (Render free ~512MB; evita crash cedo)
CMD ["node", "--max-old-space-size=460", "src/server.js"]
