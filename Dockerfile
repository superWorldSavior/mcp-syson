# The manifest-list digest resolves to reviewed amd64 and arm64 Deno images.
# Keep this in sync with the release workflow's multi-platform build.
FROM docker.io/denoland/deno@sha256:2014dc167ece617ef7e7ba40631ac2234c59e75ce693e7cc2dc2602b3c87859d

ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG CREATED=unknown
ARG TARGETARCH

LABEL org.opencontainers.image.title="Casys SysON MCP provider" \
  org.opencontainers.image.description="MCP provider for SysON and SysML v2" \
  org.opencontainers.image.source="https://github.com/superWorldSavior/mcp-syson" \
  org.opencontainers.image.revision="${REVISION}" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.created="${CREATED}" \
  org.opencontainers.image.licenses="MIT"

USER root
RUN case "$TARGETARCH" in \
    amd64) z3_sha256="4330fbffdcb23b708fa3008cde5ba00f63fe0a75bd67ac469ce16f2bd4213a1d" ;; \
    arm64) z3_sha256="615af7fe9efd494201d3978fe7b9106a609476cc2c1d0a8abe88395db352b6cc" ;; \
    *) echo "Unsupported OCI architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && apt-get update \
  && apt-get download z3=4.13.3-1 \
  && echo "$z3_sha256  z3_4.13.3-1_${TARGETARCH}.deb" | sha256sum --check - \
  && dpkg --install "z3_4.13.3-1_${TARGETARCH}.deb" \
  && rm -f "z3_4.13.3-1_${TARGETARCH}.deb" \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app /deno-dir \
  && chown -R deno:deno /app /deno-dir

WORKDIR /app
ENV DENO_DIR=/deno-dir \
  DENO_NO_UPDATE_CHECK=1

USER deno
COPY --chown=deno:deno deno.json deno.lock mod.ts server.ts ./
COPY --chown=deno:deno src ./src
RUN deno cache --frozen --lock=deno.lock --node-modules-dir=none server.ts

EXPOSE 3009

# The runtime can reach SysON and an operator-configured renderer only. Its
# single read capability lets the MCP runtime check for an optional local auth
# configuration; it receives no filesystem-write or broad subprocess access.
# z3 is the sole command needed by syson_constraint_solve.
ENTRYPOINT ["deno", "run", "--cached-only", "--frozen", "--node-modules-dir=none", "--allow-net", "--allow-read=/app/mcp-server.yaml", "--allow-env=SYSON_URL,SYSON_KROKI_URL,MCP_AUTH_PROVIDER,MCP_AUTH_AUDIENCE,MCP_AUTH_RESOURCE,MCP_AUTH_DOMAIN,MCP_AUTH_ISSUER,MCP_AUTH_JWKS_URI,MCP_AUTH_SCOPES,MCP_AUTH_RESOURCE_METADATA_URL", "--allow-run=z3", "server.ts"]
CMD ["--port=3009", "--hostname=0.0.0.0"]
