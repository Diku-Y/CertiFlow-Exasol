FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1
CMD ["npm", "start"]
