# 聚名网域名百度质量检测 · JBD Checker

> 一个 Chrome Manifest V3 扩展。在聚名网 (`juming.com`) 浏览拍卖 / 一口价 / 拼音域名列表时，自动扫描页面上的待售域名，调用百度判断每个域名的"良性程度"（是否被收录、是否降权、是否被 K），并在域名旁显示绿/黄/红徽章，辅助你为 **站群 / PBN** 选购老域名。

## 功能

- ✅ **自动扫描**：进入聚名网任意域名列表页，content script 自动用正则识别页面里的域名（com / net / cn / org / cc / top / io / me / info / biz / club / xyz / vip / wang / site / store / online / tech 等）。
- ✅ **百度检测**：背景脚本对每个域名发起 `site:domain.com` 查询，解析「百度为您找到相关结果约 X 个」/「没有找到该 URL」，再叠加首页是否排第一等启发式，给出综合判定。
- ✅ **徽章可视化**：
  - 🟢 **绿**：百度收录 ≥ 10、首页排第一、值得考虑。
  - 🟡 **黄**：收录少 / 首页未排第一 / 需要人工复核。
  - 🔴 **红**：无收录或疑似被 K / 沙盒。
  - ⚪ **灰**：尚未检测 / 正在排队。
- ✅ **悬浮详情**：鼠标停在徽章上，显示百度收录数、首页是否排第一、最近检测时间、命中规则。
- ✅ **缓存**：`chrome.storage.local` 持久化，默认 TTL 7 天，同域复查不重复请求。
- ✅ **反爬**：可配置并发数、随机延迟（1.2-3s）、UA 池随机化、验证码检测自动暂停。
- ✅ **popup 控制台**：扫描历史、CSV 导出、黑/白名单、暂停/继续按钮。
- ✅ **Options 设置页**：并发数、延迟范围、UA 池开关、Chinaz 启用、缓存 TTL、判定阈值。

## 安装

1. 克隆本仓库：
   ```bash
   git clone https://github.com/OmniMediaLab/juming-baidu-checker.git
   ```
2. 打开 Chrome，地址栏访问 `chrome://extensions`。
3. 打开右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择 `juming-baidu-checker/` 目录。
5. 打开 `https://www.juming.com/auction/`、`https://www.juming.com/buy/` 等列表页，看到徽章注入即可。

## 使用方式

1. 打开任意聚名网域名列表页（拍卖、一口价、过期、拼音等）。
2. 扩展自动扫描页面里的域名，每个域名后插入灰色徽章「待检测」。
3. 后台队列按设定的并发数 + 间隔逐个查询百度，结果实时回填到徽章。
4. 点击扩展图标打开 popup，可查看历史、暂停队列、导出 CSV。
5. 进入 Options 页可以调整并发数、延迟、是否启用 Chinaz、判定阈值等。

## 判定逻辑

后台 classifier 当前规则（可在 `background/classifier.js` 调整，也可在 Options 自定义阈值）：

| 信号 | 绿色 | 黄色 | 红色 |
|---|---|---|---|
| 百度收录数 | ≥ 10 | 1-9 | 0 |
| `site:` 首条是否本站首页 | 是 | 否 | — |
| 是否命中「该 URL 不存在」 | — | — | 命中 |
| Chinaz BR（可选） | ≥ 1 加分 | — | — |

## 反爬注意事项

- 百度搜索对高频请求会返回验证码页。扩展默认 3 并发、1.2-3s 随机延迟，正常使用 OK。
- 触发验证码时扩展会自动暂停队列并通过 popup 提示你。**手动在浏览器里打开 `https://www.baidu.com` 通过验证码后**，回到 popup 点「继续」即可。
- 频繁批量大查询前请先把 `请求间隔下限` 调大、`并发数` 改为 1。
- Chinaz / Aizhan 抓取默认关闭，作为可选增强；开启后请进一步降低并发。

## 项目结构

```
juming-baidu-checker/
├── manifest.json              # MV3 配置
├── background/
│   ├── service-worker.js      # 消息路由 + 队列启动
│   ├── scheduler.js           # 并发节流队列
│   ├── baidu-client.js        # site: 抓取 + 解析
│   ├── chinaz-client.js       # 可选 SEO 指标抓取
│   ├── classifier.js          # 信号 -> 绿/黄/红
│   ├── cache.js               # storage 包装 + TTL
│   └── dnr-rules.json         # declarativeNetRequest UA 改写规则
├── content/
│   ├── content-script.js      # 入口：扫描 + Mutation 监听
│   ├── domain-extractor.js    # 域名正则提取与过滤
│   ├── badge-injector.js      # 注入与更新徽章 DOM
│   └── content.css            # 徽章样式
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── lib/
│   ├── messaging.js           # 消息协议常量
│   ├── ua-pool.js             # UA 池
│   └── utils.js               # 工具函数
├── assets/                    # 图标
└── _locales/zh_CN/messages.json
```

## 免责声明

本扩展仅供 **个人 SEO 学习与研究** 使用。请遵守目标网站的 ToS 与所在国 / 地区的法律法规。**不要** 在生产环境或大批量场景中使用，作者不为任何后果负责。

## License

MIT © 2026 OmniMediaLab
