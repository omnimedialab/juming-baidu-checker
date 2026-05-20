# 聚名网域名百度质量检测 Chrome 扩展 — 工作计划

## Requirements Summary
- Chrome Manifest V3 扩展，零依赖纯原生 JS（避免构建链复杂度）
- 注入聚名网相关域（`juming.com`、`*.juming.com`、`jumingauction.com`）
- 扫描页面 DOM 中出现的待售/竞拍域名
- 后台并发查询百度判断"良性 / 值得入手"：
  - `site:domain.com` 收录数（核心指标）
  - 是否被降权 / 沙盒 / 拔毛（首页未排第一、收录暴跌等启发式）
  - 可选：抓 Chinaz / Aizhan 拿 BR、外链
- 在域名旁注入绿/黄/红徽章 + 悬浮详情
- popup 提供：历史、CSV 导出、白/黑名单、节流配置
- chrome.storage 缓存（TTL 7 天）
- 反爬：UA 池、随机延迟、并发节流、验证码检测自动暂停
- 推 GitHub: `OmniMediaLab/juming-baidu-checker`

## File Structure
```
juming-baidu-checker/
├── manifest.json
├── background/
│   ├── service-worker.js     # 消息路由 + 启动 scheduler
│   ├── scheduler.js          # 并发节流队列
│   ├── baidu-client.js       # site: 查询 + HTML 解析
│   ├── chinaz-client.js      # 可选 SEO 指标
│   ├── classifier.js         # 信号 -> green/yellow/red
│   └── cache.js              # storage 封装 + TTL
├── content/
│   ├── content-script.js     # 入口：扫描 + Mutation 监听
│   ├── domain-extractor.js   # 正则提取 + 过滤
│   ├── badge-injector.js     # 注入/更新徽章 DOM
│   └── content.css
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── lib/
│   ├── messaging.js          # 消息协议常量
│   ├── ua-pool.js
│   └── utils.js
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── _locales/zh_CN/messages.json
├── README.md
├── LICENSE
└── .gitignore
```

## Implementation Phases

### Phase 1 — 项目骨架
- `manifest.json` (MV3)，permissions: `storage`, `alarms`, `declarativeNetRequest`, `scripting`
- host_permissions: `*://*.juming.com/*`, `*://*.baidu.com/*`, `*://*.chinaz.com/*`, `*://*.aizhan.com/*`
- 图标占位 + .gitignore + README + LICENSE(MIT)

### Phase 2 — Content Script
- 域名正则 `[a-z0-9-]+\.(com|net|cn|org|cc|top|io|me|info|biz|club|xyz|vip|wang|site|store|online|tech)\b`（小写匹配）
- 过滤白名单：juming.com、cdn.bootcss.com、staticfile 等
- MutationObserver 处理 ajax 翻页
- 注入徽章 inline `<span class="jbd-badge jbd-pending">…</span>`
- 悬停 tooltip 显示详情

### Phase 3 — Background
- Scheduler：默认 3 并发，请求间隔随机 1.2-3.0s
- baidu-client：抓 `https://www.baidu.com/s?wd=site%3A{domain}&rn=10`，解析"百度为您找到相关结果约 X 个" / "没有找到该URL"
- 验证码检测：HTML 含 `wappass.baidu.com` 或 `verify` 关键字 → 暂停队列 + 通知
- 缓存 key=`baidu:{domain}`，TTL 7 天
- classifier：
  - 收录 = 0 → 红（未收录或被 K）
  - 收录 1-9 + 首页非第一 → 黄
  - 收录 ≥10 + 首页第一 → 绿
  - 高级：可选 chinaz BR ≥1 加分

### Phase 4 — Popup
- 当前 tab 进度条 + 域名表
- 全部历史（最近 500 条）+ 状态过滤
- CSV 导出（domain, status, baidu_count, ranks_first, checked_at）
- 白/黑名单快捷管理

### Phase 5 — Options
- 并发数（1-5）、延迟下/上限、UA 池开关、chinaz 启用、缓存 TTL、自定义阈值

### Phase 6 — 打包 + 推送
- chrome://extensions load unpacked 自测
- git commit，推到 OmniMediaLab/juming-baidu-checker

## Acceptance Criteria
1. 在 `https://www.juming.com/auction/` 列表打开扩展，5 秒内识别 ≥10 个域名并显示 pending 徽章
2. 任务队列处理完后，徽章变为绿/黄/红，反映真实百度收录
3. 同一域名 7 天内复查走缓存（fetch 0 次）
4. popup 能展示扫描历史、导出 CSV 字段完整
5. Options 并发改为 1 后，请求严格串行 + 间隔 ≥设定下限
6. 触发百度验证码时自动暂停队列并 toast 提示
7. `gh repo view OmniMediaLab/juming-baidu-checker` 公开/私有可访问，clone 后 load unpacked 直接可跑

## Risks & Mitigations
| 风险 | 缓解 |
|---|---|
| 百度风控 / 验证码 | UA 池 + 随机延迟 + 并发节流 + 验证码检测 → 自动暂停 + 用户在浏览器手动通过 |
| MV3 service worker 休眠 | 任务状态写入 chrome.storage；用 chrome.alarms 防止长时间空闲 |
| 聚名网 DOM 改版 | 不依赖具体类名，纯正则 + textNode 扫描兜底 |
| chinaz/aizhan 抓取受限 | 默认关闭，作为可选增强 |
| 跨域 fetch | background fetch + manifest host_permissions 声明 |
| 法律 / ToS | README 声明仅供个人 SEO 研究使用 |

## Verification Steps
- chrome://extensions 载入无 manifest 报错
- DevTools (service worker) 看 fetch 日志
- 在 juming.com 打开列表页查徽章变化
- chrome.storage 缓存条目存在
- popup CSV 导出可在 Excel 打开
- `gh repo view OmniMediaLab/juming-baidu-checker` 通过
