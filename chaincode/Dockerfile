FROM golang:1.25.13-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN go build -o registrar_cc main.go


FROM alpine:3.24

WORKDIR /app

RUN apk add --no-cache --upgrade \
    bash \
    ca-certificates \
    libcrypto3 \
    libssl3 && \
    addgroup -S -g 10001 blockgo && \
    adduser -S -D -H -u 10001 -G blockgo blockgo

COPY --from=builder --chown=10001:10001 /app/registrar_cc .

USER 10001:10001

CMD ["./registrar_cc"]