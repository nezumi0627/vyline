FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY .build-context/package.json .build-context/bun.lock ./
COPY .build-context/Vyline/ ./Vyline/
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run build

FROM oven/bun:1.4.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl fuse3 mount \
  && rm -rf /var/lib/apt/lists/*

ARG TIGRISFS_VERSION=1.2.3
RUN ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in amd64) ARCH=amd64 ;; arm64) ARCH=arm64 ;; *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;; esac \
  && curl -fL "https://github.com/tigrisdata/tigrisfs/releases/download/v${TIGRISFS_VERSION}/tigrisfs_${TIGRISFS_VERSION}_linux_${ARCH}.tar.gz" -o /tmp/tigrisfs.tar.gz \
  && tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/ \
  && rm /tmp/tigrisfs.tar.gz \
  && chmod +x /usr/local/bin/tigrisfs

WORKDIR /app
COPY .build-context/package.json .build-context/bun.lock ./
COPY .build-context/Vyline/ ./Vyline/
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY --from=build /app/Vyline/apps/desktop/dist ./Vyline/apps/desktop/dist
COPY start.sh /usr/local/bin/vyline-cloudflare-start
RUN chmod +x /usr/local/bin/vyline-cloudflare-start

ENV NODE_ENV=production
EXPOSE 3001
CMD ["/usr/local/bin/vyline-cloudflare-start"]
