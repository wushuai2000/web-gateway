# Multi-stage build: the official xray image ships no shell, so compile the
# binary from source and carry only the artifact into a small Alpine image.
FROM golang:1.25-alpine AS builder
ARG XRAY_VERSION=v26.10.31
RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 --branch ${XRAY_VERSION} https://github.com/XTLS/Xray-core.git . \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/xray ./main

FROM node:20-alpine
RUN apk add --no-cache tzdata
COPY --from=builder /out/xray /usr/local/bin/xray
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js setup.js ./
ENV XRAY_BIN=/usr/local/bin/xray \
    PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
