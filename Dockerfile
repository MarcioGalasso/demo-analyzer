FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY .env.example ./

ENV NODE_ENV=production
ENV PORT=5055

EXPOSE 5055

CMD ["node", "src/server.js"]
