FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/index.js ./index.js
ENV NODE_ENV=production
EXPOSE 10000
CMD ["npm", "start"]
