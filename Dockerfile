FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY index.js logo.png ./
USER node
EXPOSE 7001
CMD ["node", "index.js"]
