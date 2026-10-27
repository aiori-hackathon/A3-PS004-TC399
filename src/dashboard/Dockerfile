FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .
COPY public ./public
RUN mkdir -p public/vendor && cp node_modules/chart.js/dist/chart.umd.js public/vendor/chart.umd.js
EXPOSE 3000
CMD ["npm", "start"]
