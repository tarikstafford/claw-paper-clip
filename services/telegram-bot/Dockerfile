FROM node:lts-trixie-slim
RUN corepack enable

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

EXPOSE 3005
CMD ["npx", "tsx", "src/main.ts"]
