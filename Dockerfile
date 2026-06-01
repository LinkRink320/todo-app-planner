FROM node:20-alpine

WORKDIR /app

# Build tools to compile sqlite3 native module against musl libc
RUN apk add --no-cache python3 py3-setuptools make g++

COPY . .

RUN npm ci --build-from-source=sqlite3

EXPOSE 3000

CMD ["node", "backend/server.js"]
