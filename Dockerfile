FROM node:24-alpine

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

RUN mkdir -p /data && chown node:node /data

ENV X_TOKEN_FILE=/data/refresh-token
VOLUME ["/data"]

USER node

ENTRYPOINT ["node", "/app/src/index.js"]
