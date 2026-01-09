FROM alpine:3.19

ARG TUSD_VERSION=1.13.0
ARG TARGETARCH

RUN apk add --no-cache bash ca-certificates curl jq openssl tar

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
