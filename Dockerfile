# MPS 단일 이미지: React 프론트엔드 빌드 + Node API/실시간 서버
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
ARG VITE_SHOW_DEMO=0
ENV VITE_SHOW_DEMO=$VITE_SHOW_DEMO
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production WEB_DIST=/app/web
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /web/dist /app/web
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "src/index.js"]
