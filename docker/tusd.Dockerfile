FROM tusproject/tusd:latest

RUN apk add --no-cache bash curl openssl jq coreutils

COPY backend/tusd-hooks /tusd-hooks
