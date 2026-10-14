# One image per service, chosen at build time:
#   docker build --build-arg SERVICE=notifier -t behindme-notifier .
# On Railway, set the SERVICE variable on each service: it is passed as this build argument.
# See docs/deploy.md.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY apps apps
COPY libs libs
ARG SERVICE=gateway
RUN npx nest build "$SERVICE"

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
ARG SERVICE=gateway
ENV SERVICE=$SERVICE
COPY --from=build /app/dist/apps/$SERVICE dist/apps/$SERVICE
USER node
# PORT comes from the host (Railway sets it); each service has its own default otherwise.
CMD ["sh", "-c", "exec node dist/apps/$SERVICE/apps/$SERVICE/src/main.js"]
