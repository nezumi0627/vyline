# Vyline — Bun ベースの軽量ランタイムイメージ
# ビルド: docker build -t vyline .
# 実行:  docker run -p 127.0.0.1:3000:3000 -v ./data:/app/data vyline

ARG BUN_VERSION=1.4.0
ARG VYLINE_VERSION=dev
FROM --platform=$BUILDPLATFORM golang:1.27.1-bookworm AS openai-tunnel
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/tunnel-client
# Upstream v0.0.14 binaries contain vulnerable x/net and OpenTelemetry SDK versions.
# Keep the complete upstream CLI, rebuilding its pinned source with patched dependency locks.
RUN curl --fail --location --retry 3 \
      https://codeload.github.com/openai/tunnel-client/tar.gz/0f870e50a973fa820d4c409000059e181e8d242b -o /tmp/tunnel-source.tar.gz \
  && echo "0281b17c0979f9db1ae2b41b0b66df697d646e726995756a003c6ffc51a64c10  /tmp/tunnel-source.tar.gz" | sha256sum --check - \
  && tar -xzf /tmp/tunnel-source.tar.gz --strip-components=1 -C /src/tunnel-client
COPY Vyline/integrations/vyline-chatgpt/tunnel-client/go.mod Vyline/integrations/vyline-chatgpt/tunnel-client/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOTOOLCHAIN=local go mod download && go mod verify \
  && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} GOTOOLCHAIN=local \
    go build -mod=readonly -trimpath -buildvcs=false \
      -ldflags="-s -w -X github.com/openai/tunnel-client/pkg/version.semanticVersion=0.0.14-vyline.1 -X github.com/openai/tunnel-client/pkg/version.GitSHA=0f870e50a973fa820d4c409000059e181e8d242b" \
      -o /usr/local/bin/tunnel-client ./cmd/client

FROM eclipse-temurin:17-jdk-jammy AS compose-java

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock* ./
COPY Vyline/apps/desktop/package.json Vyline/apps/desktop/
COPY Vyline/backend/package.json Vyline/backend/
COPY Vyline/packages/types/package.json Vyline/packages/types/
COPY Vyline/packages/ios-backup/package.json Vyline/packages/ios-backup/
COPY Vyline/packages/protocol/package.json Vyline/packages/protocol/
COPY Vyline/packages/line-types/package.json Vyline/packages/line-types/
COPY Vyline/packages/loose-types/package.json Vyline/packages/loose-types/
COPY Vyline/packages/plugin/sdk/package.json Vyline/packages/plugin/sdk/
COPY Vyline/packages/themes/package.json Vyline/packages/themes/
RUN bun install --ignore-scripts

FROM deps AS prod-deps
RUN rm -rf node_modules Vyline/*/node_modules Vyline/*/*/node_modules \
  && bun install --production --ignore-scripts

ARG BUN_VERSION=1.4.0
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
# Gradle's downloaded Node.js requires the GNU atomic support library.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libatomic1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=compose-java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:${PATH}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/Vyline/apps/desktop/node_modules ./Vyline/apps/desktop/node_modules
COPY --from=deps /app/Vyline/backend/node_modules ./Vyline/backend/node_modules
COPY --from=deps /app/Vyline/packages ./Vyline/packages
COPY . .
RUN bun run build

ARG BUN_VERSION=1.4.0
FROM oven/bun:${BUN_VERSION} AS runtime
ARG VYLINE_VERSION
WORKDIR /app
ENV NODE_ENV=production \
    VYLINE_VERSION=${VYLINE_VERSION} \
    VYLINE_HOST=0.0.0.0 \
    PORT=3000 \
    VYLINE_DATA_DIR=/app/data \
    VYLINE_STORAGE_DIR=/app/storage \
    VYLINE_CDN_CACHE_DIR=/app/storage/cache/cdn-cache \
    VYLINE_ICON_CACHE_DIR=/app/storage/cache/icons \
    VYLINE_MEDIA_STORAGE_DIR=/app/storage/saved-media
LABEL org.opencontainers.image.title="Vyline" \
      org.opencontainers.image.source="https://github.com/tqmane/vyline" \
      org.opencontainers.image.version="${VYLINE_VERSION}"
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends gosu ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/Vyline/backend/node_modules ./Vyline/backend/node_modules
COPY --from=build /app/Vyline/packages ./Vyline/packages
COPY --from=build /app/openapi.yaml ./openapi.yaml
COPY --from=build /app/Vyline/backend/src ./Vyline/backend/src
COPY --from=build /app/Vyline/apps/desktop/dist ./Vyline/apps/desktop/dist
COPY docker-entrypoint.sh /usr/local/bin/vyline-entrypoint
COPY --from=openai-tunnel /usr/local/bin/tunnel-client /usr/local/bin/tunnel-client
RUN mkdir -p /app/data /app/storage \
  && chown -R bun:bun /app/data /app/storage \
  && chmod 0755 /usr/local/bin/vyline-entrypoint
EXPOSE 3000
STOPSIGNAL SIGTERM
VOLUME ["/app/data", "/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/healthz").then(function(r){process.exit(r.ok?0:1)},function(){process.exit(1)})'
ENTRYPOINT ["/usr/local/bin/vyline-entrypoint"]
CMD ["bun", "Vyline/backend/src/index.ts"]
