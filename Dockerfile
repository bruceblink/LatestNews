# =========================
# Build stage
# =========================
FROM node:22-alpine AS builder

WORKDIR /usr/src

COPY . .
RUN corepack enable
RUN pnpm install

# 再复制源码
COPY . .

# -------- build-time env --------
# 只用于 Vite 编译阶段
ARG VITE_APP_TITLE
ENV VITE_APP_TITLE=${VITE_APP_TITLE}

# 其他 VITE_* 也可以按需加
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm run build


# =========================
# Runtime stage
# =========================
FROM node:22-alpine

WORKDIR /usr/app

# 只拷贝构建产物
COPY --from=builder /usr/src/dist/output ./output

# -------- runtime env --------
# 仅 Node / Nitro 运行时需要的变量
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4444

EXPOSE 4444

CMD ["node", "output/server/index.mjs"]
