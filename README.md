# DSH Page Bridge

把当前浏览器标签页的**正文**（渲染后的文本，不是源码）发给本机的一个小接收端，
让本地 AI agent（例如 DeepSeek Harness）能"读"你看的页面——不用截图、不用 OCR。

Send the rendered text of your current tab to a local receiver, so a local AI agent
can read the page. No screenshots, no OCR, no cloud.

## 它解决什么

- 需要**登录**才能看的页面（学校系统、报名页、后台）→ AI 也能读
- 强 JS 渲染的单页应用 → 直接拿到渲染结果，不用猜
- 隐私优先：正文只发到 `127.0.0.1`，不出本机，不经过任何第三方

## 组成

```
extension/   浏览器扩展（MV3）——只在点击/快捷键那一刻读取当前页
server/      本机接收端（Node.js，零依赖）——监听 127.0.0.1:8777，落盘 last-page.json
```

## 安装

### 1. 启动接收端

需要 Node.js 18+。

```bash
cd server
node server.mjs        # Windows 也可以双击 start-bridge.cmd
```

看到 `listening on http://127.0.0.1:8777` 即为就绪，**保持窗口开着**。

### 2. 装扩展（Edge / Chrome 通用）

1. 地址栏打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 打开「开发人员模式」
3. 点「加载解压缩的扩展」，选择本仓库的 **`extension/`** 目录
4. 在扩展详情里，把站点访问权限里的 `http://127.0.0.1/*` 打开（默认可能是关的）

### 3. 用

- 点工具栏图标 → 弹窗显示连接状态 → 点「发送当前页面」
- 或直接按 **Alt+Shift+S**

图标角标 `OK` 表示发送成功，`X` 表示失败（多半是接收端没开）。

## 输出格式

`server/last-page.json`：

```json
{
  "title": "页面标题",
  "url": "https://…",
  "text": "渲染后的正文（最多 60000 字，连续空行已压缩）",
  "headings": ["h1/h2/h3 文本"],
  "links": [{ "text": "链接文字", "href": "https://…" }],
  "sentAt": "2026-11-07T03:20:00.000Z",
  "tabTitle": "标签页标题"
}
```

## 界面（v2.2）

点扩展图标 = **完整状态面板**，不再单开窗口。弹窗每 2 秒刷新：

| 状态 | 含义 |
|---|---|
| 灰 · 还没有发送页面 | 尚未发送过 |
| 橙 · 已发送，等待 AI 读取 | 接收端已收到，AI 还没读 |
| 绿 · AI 已读取 | AI 已经读过这份页面 |

确认链来自接收端三个接口：

- `POST /page` → 写入页面并把 `readAt` 置空
- `GET /last` → 返回页面**并标记已读**（`readAt=now`）
- `GET /state` → 弹窗轮询用，**不产生读取副作用**

> DSH / AI 不会因为收到页面就自动运行。发送后需要在对话框里说一句
> 「读一下刚才的页面」，AI 读取后弹窗才会变绿。

## 抓取能力（v2.3）

为了应对重 JS 渲染的页面，采集分三步：

1. **等稳定**：抓取前轮询 `document.body.innerText` 长度，连续两次不变（最多 3 秒）才开始采集，避免抓到只渲染了一半的骨架。
2. **穿透同源 iframe**：递归读取同源 `<iframe>` 的文档，最多 4 层。
3. **穿透 shadow DOM**：遍历开放（open）的 shadow root，最多 5 层。

弹窗的「字数」后面会显示采集规模，例如 `2687 字（2 帧/3 shadow）`。
正文低于 200 字时会提示可能是「没渲染完」或「主体在跨域 iframe 里」。

> **跨域 iframe 抓不到**：浏览器同源策略禁止扩展读取其他域的 iframe，这是硬限制，任何扩展都一样。
> Partner Center、部分网盘和支付页面就属于这种结构。

## AI 主动索取（v2.4）

除了你手动点击/按快捷键，AI 也可以主动要求抓取当前页面——你不用点任何东西。

协议：

1. AI 向接收端发起 `POST /grab`，得到一个请求 id；
2. 扩展在后台长轮询 `GET /grab/pending?wait=25000`，**1–2 秒内**就会取到请求；
3. 扩展立即抓取当前标签页，把正文连同 `grabId` 一起 `POST /page` 回来。

> MV3 的后台 service worker 会被浏览器回收，回收后最长要约 1 分钟才会被闹钟叫醒。
> 想立刻唤醒：点一下扩展图标即可。

## 权限说明

| 权限 | 为什么需要 |
|---|---|
| `activeTab` | 只在你点图标/按快捷键时，才获得**当前这一页**的读取权 |
| `scripting` | 注入一小段脚本读取 `document.body.innerText` |
| `storage` | 记住接收端地址和上一次发送结果 |
| `host_permissions: http://127.0.0.1/*` | 仅允许把数据发到本机 |

没有 `tabs`、没有 `<all_urls>`、没有远程代码。

## 发布

### GitHub

```bash
git init
git add .
git commit -m "feat: initial commit"
git branch -M main
git remote add origin https://github.com/<你的账号>/dsh-page-bridge.git
git push -u origin main
```

### Edge 加载项商店

1. 把 `extension/` 目录单独打成一个 zip（zip 内**顶层就是 manifest.json**，不能多套一层文件夹）
2. 打开 [Edge 加载项开发者中心](https://partner.microsoft.com/dashboard/microsoftedge/overview) 注册（免费）
3. 新建项目 → 上传 zip → 填描述、截图、隐私说明
4. 隐私说明可直接引用本 README 的安全章节：不收集、不上传、仅本机通信

> 商店审核会重点看 `host_permissions`。这里只声明 `127.0.0.1`，属于最窄的一档，容易过。

## 已知限制

- `edge://`、`chrome://` 等浏览器内置页禁止扩展读取，属浏览器限制
- 正文上限 60000 字（可在 `background.js` 的 `MAX_TEXT` 调整）
- 只发文本，不发图片；页面里的图片链接仍保留在 `links` 里

## 许可

MIT
