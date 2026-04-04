FROM debian:bookworm-slim

ARG TUSD_VERSION=1.13.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl jq openssl tar \
    && rm -rf /var/lib/apt/lists/*

RUN arch="${TARGETARCH:-amd64}" \
    && curl -L -o /tmp/tusd.tar.gz "https://github.com/tus/tusd/releases/download/v${TUSD_VERSION}/tusd_linux_${arch}.tar.gz" \
    && tar -xzf /tmp/tusd.tar.gz -C /tmp \
    && mv "/tmp/tusd_linux_${arch}/tusd" /usr/local/bin/tusd \
    && chmod +x /usr/local/bin/tusd \
    && rm -rf /tmp/tusd*

COPY backend/tusd-hooks /tusd-hooks

RUN chmod +x /tusd-hooks/pre-create /tusd-hooks/post-finish

WORKDIR /app
EXPOSE 1080

ENTRYPOINT ["tusd"]
