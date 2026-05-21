# link113-notify

把 link113 OpenAPI 回调结果转发到 Telegram 群。

部署目录：`/opt/link113-notify`（在 sky 服务器上）。

## 配置

写一个 `/opt/link113-notify/.env`：

```
TG_BOT_TOKEN=8776424765:xxxxx
TG_CHAT_ID=-1001234567890
PORT=3119
# 可选
# ALLOW_IPS=212.129.155.107
# SHARED_SECRET=somelongrandom
```

## 启动 (pm2)

```
cd /opt/link113-notify
pm2 start ecosystem.config.js
pm2 save
```

## nginx

参考 `nginx.link113-notify.conf`，放到 `/etc/nginx/conf.d/link113-notify.conf`，
先 `certbot certonly --nginx -d link.gamelinklab.com` 拿证书，然后 `nginx -t && systemctl reload nginx`。

## 健康检查

```
curl -s https://link.gamelinklab.com/health
# 期望: OK link113-notify
```

## link113 回调地址

在 link113 后台配置回调：`https://link.gamelinklab.com/notify`
