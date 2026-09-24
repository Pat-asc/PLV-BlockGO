FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npx tailwindcss init -p && \
    echo "module.exports = { content: ['./src/**/*.{js,jsx,ts,tsx}'], theme: { extend: {} }, plugins: [] }" > tailwind.config.js && \
    echo "@tailwind base; @tailwind components; @tailwind utilities;" > src/index.css

RUN DISABLE_ESLINT_PLUGIN=true npm run build


FROM nginx:alpine

USER root

RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache libcap && \
    setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx && \
    mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp && \
    chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html

COPY --from=build --chown=nginx:nginx \
    /app/build /usr/share/nginx/html

RUN printf '%s\n' \
    'server {' \
    '    listen 80;' \
    '    server_name _;' \
    '' \
    '    root /usr/share/nginx/html;' \
    '    index index.html;' \
    '' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '    }' \
    '' \
    '    location = /nginx-health {' \
    '        access_log off;' \
    '        default_type text/plain;' \
    '        return 200 "ok\n";' \
    '    }' \
    '}' \
    > /etc/nginx/conf.d/default.conf && \
    sed -i 's|pid[[:space:]].*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf

EXPOSE 80

USER nginx

CMD ["nginx", "-g", "daemon off;"]
