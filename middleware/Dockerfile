FROM node:20-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global npm@11 && \
    npm --version

WORKDIR /app

RUN python3 -m venv /opt/blockgo-venv

ENV PATH="/opt/blockgo-venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1

COPY package*.json ./
COPY requirements.txt ./

RUN npm ci --omit=dev

RUN python -m pip install --no-cache-dir --upgrade pip && \
    python -m pip install --no-cache-dir -r requirements.txt && \
    python -m pip install --no-cache-dir --upgrade \
        "msgpack>=1.2.1" \
        "setuptools>=78.1.1" && \
    python -m pip check

COPY . .

FROM node:20-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /opt/blockgo-venv /opt/blockgo-venv

COPY --from=builder --chown=node:node /app /app

ENV PATH="/opt/blockgo-venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 4000 4001 4002 4003 4004 4005

ENV PORT=4000
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256 --expose-gc"

USER node

HEALTHCHECK \
    --interval=30s \
    --timeout=5s \
    --start-period=30s \
    --retries=3 \
    CMD node -e "const http=require('http');const req=http.get({host:'127.0.0.1',port:process.env.PORT||4000,path:'/api/health',timeout:4000},res=>process.exit(res.statusCode===200?0:1));req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',()=>process.exit(1));"

CMD ["node", "middleware.js"]