FROM node:20-alpine
WORKDIR /app
COPY package.json engine.mjs pilot.mjs server.mjs ./
COPY public ./public
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
