# syntax=docker/dockerfile:1

# 1. Tracker script and dashboard
FROM oven/bun:1.4 AS web
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/tracker/package.json packages/tracker/
RUN bun install --frozen-lockfile \
    # GeoIP database from @ip-location-db/dbip-city-mmdb (DB-IP Lite, CC BY 4.0).
    # -L follows bun's symlinks so the real files are copied.
    && mkdir -p /geoip \
    && cp -L node_modules/@ip-location-db/dbip-city-mmdb/*.mmdb node_modules/@ip-location-db/dbip-city-mmdb/DBIP-LICENSE /geoip/
COPY apps apps
COPY packages packages
COPY web web
ARG GIT_COMMIT=unknown
ENV VITE_GIT_COMMIT=$GIT_COMMIT
RUN bun --bun run --filter tracker build && bun --bun run --filter dashboard build

# 2. Go binary. DuckDB is a C++ library, so this needs cgo.
FROM golang:1.26-bookworm AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd cmd
COPY internal internal
COPY web/embed.go web/
COPY --from=web /src/web/dist web/dist
COPY --from=web /src/web/static web/static
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/tinytraffic ./cmd/tinytraffic \
    && mkdir /out/data

# 3. Runtime: glibc + libstdc++, no shell, non-root.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /out/tinytraffic /usr/local/bin/tinytraffic
COPY --from=web /geoip /usr/share/tinytraffic/geoip
COPY --from=server --chown=nonroot:nonroot /out/data /data
ENV TT_ADDR=:8080 \
    TT_DATA_DIR=/data \
    TT_GEOIP_DB=/usr/share/tinytraffic/geoip/dbip-city-ipv4.mmdb,/usr/share/tinytraffic/geoip/dbip-city-ipv6.mmdb
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/tinytraffic"]
CMD ["serve"]
