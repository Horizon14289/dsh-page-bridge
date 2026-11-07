# DSH Page Bridge v2.2.0

把浏览器当前标签页的**渲染文本**发给本机接收端，让本地 AI（如 DeepSeek Harness）直接读页面——不用截图、不用 OCR、不上云。

## 这一版新增

- **一个界面搞定**：点扩展图标就是完整状态面板，不再单开窗口
- **三态状态卡**：灰（还没发送）/ 橙（已发送，等待 AI 读取）/ 绿（AI 已读取）
- **详情行**：标题、来源域名、字数、收到时间、读取时间
- **读取确认链**：`POST /page` 写入并清空 `readAt`；`GET /last` 返回内容同时标记已读；`GET /state` 只读不副作用
- **设置页**：自定义接收端地址 + DSH 网页地址（面板里出现「打开 DSH」按钮）
- **友好报错**：内置页/商店页/连不上接收端，都给出人话提示

## 安装

1. 本机装 [Node.js](https://nodejs.org) 18+
2. 解压本 Release 的 `dsh-page-bridge-2.2.0-source.zip`，进 `server/` 跑 `node server.mjs`
3. 浏览器打开 `edge://extensions`（或 `chrome://extensions`）→ 开发人员模式 → 加载解压缩的扩展 → 选 `extension/`
4. 在扩展详情里打开 `http://127.0.0.1/*` 的站点访问权限

## 用法

网页上按 **Alt+Shift+S**，或点图标 →「发送当前页面」。
然后回对话框说一句「读一下刚才的页面」，面板会从橙变绿。

> AI 不会因为收到页面就自动运行——它只在你发消息时工作。这一点没法绕过。

## 权限

`activeTab` + `scripting` + `storage` + `host_permissions: http://127.0.0.1/*`
没有 `<all_urls>`、没有 `tabs`、没有远程代码。

## 校验

| 文件 | 说明 |
|---|---|
| `dsh-page-bridge-extension-2.2.0.zip` | 商店上传用（zip 顶层即 manifest.json） |
| `dsh-page-bridge-2.2.0-source.zip` | 完整源码（含 server/） |

MIT License
