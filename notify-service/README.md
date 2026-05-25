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
# 聚合模式：>0 把同 host+session 的多个 item 回调缓冲再合并发到 TG。
# 静默 N ms 后才 flush。0 = 关闭(默认),每个 item 立即发一条。
# AGGREGATE_WAIT_MS=20000
```

## item 编码对照

link113 每个 item 是独立查询，回调 result 只是单个数字字符串。常用：

| item | 含义 |
|------|------|
| `baidu-s-count-day` | 百度日收 |
| `baidu-s-count-week` | 百度周收 |
| `baidu-s-count-month` | 百度月收 |
| `baidu-s-count-year` | 百度年收 |
| `baidu-s-count-all` | 百度总收 |
| `baidu-check` | 百度是否收录 |
| `sogou-s-count` | 搜狗总收 |
| `so-s-count` | 360 总收 |
| `bing-s-count` | 必应总收 |

完整列表见 `GET https://api.link113.com/api/items/list`。

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
