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
    libssl3

COPY --from=builder /app/registrar_cc .

CMD ["./registrar_cc"]