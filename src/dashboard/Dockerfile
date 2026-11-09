FROM node:22-slim AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund --maxsockets=200 --fetch-retries=5 --fetch-timeout=120000
COPY web/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
COPY --from=webbuild /web/dist ./public
EXPOSE 3000
CMD ["npm", "start"]