# 待 VPS 改版更新
# 镜像内的进程仍然只绑定 localhost。Caddy 或隧道必须与它在同一网络命名空间。
# 不在镜像里写入秘密。
FROM node:22-bookworm-slim

WORKDIR /opt/vr-mcp-relay

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY services ./services
COPY apps ./apps

USER node

EXPOSE 8787 8788

CMD ["node", "services/relay/src/index.js"]
