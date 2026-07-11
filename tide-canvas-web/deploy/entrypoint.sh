#!/bin/sh
# 前端容器入口：Next SSR（127.0.0.1:3000，仅本机可达）后台运行，
# nginx（80/443）前台接管容器生命周期。
set -e

node server.js &

exec nginx -g "daemon off;"
