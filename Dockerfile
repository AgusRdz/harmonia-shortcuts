FROM node:20-alpine
RUN apk add --no-cache git bash
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npm install -g @vscode/vsce@3
COPY . .
CMD ["/bin/sh"]
