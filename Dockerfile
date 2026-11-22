FROM node:22-alpine

WORKDIR /app

COPY package.json server.js kroger.js almanac.js recipe-importer.js ./
COPY public ./public

RUN mkdir -p /data/backups && chown -R node:node /app /data

USER node

ENV PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    MAX_BACKUPS=20 \
    BACKUP_INTERVAL_SEC=60 \
    MAX_BODY_MB=50

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
