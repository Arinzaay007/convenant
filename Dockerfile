FROM node:20-alpine
WORKDIR /app
COPY package.json engine.mjs pilot.mjs covenant-server.mjs main.mjs ./
COPY public ./public
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "main.mjs"]
