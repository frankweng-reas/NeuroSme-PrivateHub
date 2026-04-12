# ── Stage 1: build ─────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# On-prem 固定參數（不需要改）
ARG VITE_APP_NAME=NeuroSme
ARG VITE_AUTH_ALLOW_REGISTER=false
ARG VITE_AUTH_ALLOW_FORGOT_PASSWORD=false

ENV VITE_APP_NAME=$VITE_APP_NAME
ENV VITE_AUTH_ALLOW_REGISTER=$VITE_AUTH_ALLOW_REGISTER
ENV VITE_AUTH_ALLOW_FORGOT_PASSWORD=$VITE_AUTH_ALLOW_FORGOT_PASSWORD

RUN npm run build

# ── Stage 2: serve static ───────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA routing：所有 path 回到 index.html
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
