FROM node:22.19.0-alpine3.22

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node server ./server
RUN mkdir /data && chown node:node /data

ENV NODE_ENV=production PORT=8780 HOST=0.0.0.0 DATA_DIR=/data
USER node
EXPOSE 8780
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8780/api/health >/dev/null || exit 1
CMD ["node", "server/server.mjs"]
