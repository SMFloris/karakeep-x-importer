FROM node:24-alpine

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

CMD ["node", "/app/src/index.js"]
