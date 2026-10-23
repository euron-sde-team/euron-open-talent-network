# syntax=docker/dockerfile:1.7
# Fake moderation provider for local development and the test matrix
# (MODERATION_PROVIDER=stub). A single dependency-free script, port 5109. The health
# check only needs the server to answer HTTP, whatever the path returns.
#   docker build -f infra/docker/ai-stub.Dockerfile -t open-talent-ai-stub .
FROM node:22.23.4-alpine
ENV NODE_ENV=production PORT=5109
WORKDIR /app
COPY --chown=node:node apps/ai-stub/ ./
USER node
EXPOSE 5109
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5109)+'/').then(()=>process.exit(0)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
