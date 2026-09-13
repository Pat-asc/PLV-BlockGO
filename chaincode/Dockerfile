FROM golang:1.27.1-alpine AS builder

USER root

RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache \
        git \
        ca-certificates

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux \
    go build \
    -trimpath \
    -ldflags="-s -w" \
    -o registrar_cc \
    main.go

FROM alpine:latest

USER root

RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache \
        bash \
        ca-certificates && \
    rm -rf /var/cache/apk/*

WORKDIR /app

COPY --from=builder /app/registrar_cc /app/registrar_cc

RUN addgroup -S -g 10001 chaincode && \
    adduser -S -D -H \
        -u 10001 \
        -G chaincode \
        chaincode && \
    chown -R 10001:10001 /app

USER 10001:10001

ENTRYPOINT ["/app/registrar_cc"]