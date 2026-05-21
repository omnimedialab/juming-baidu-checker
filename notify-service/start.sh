#!/bin/bash
# 加载 .env 并启动 link113 notify 服务（pm2 通过 ecosystem.config.js 调用本脚本）
set -a
source /opt/link113-notify/.env
set +a
exec node /opt/link113-notify/server.js
