# EmbyProxy-CF-FAKE

<p align="center">
  <img src="https://img.shields.io/badge/version-v3.8.27-32ade6" alt="version">
  <img src="https://img.shields.io/badge/platform-Cloudflare%20Workers-32ade6" alt="platform">
  <img src="https://img.shields.io/badge/storage-D1%20%2B%20Durable%20Objects-32ade6" alt="storage">
  <img src="https://img.shields.io/badge/panel-SaaS%20UI%20%E4%BC%AA%E8%A3%85%E8%A7%82%E7%9C%8B%E9%9D%A2%E6%9D%BF-32ade6" alt="panel">
</p>

Cloudflare Workers 版 Emby 反向代理 + 伪装观看（保活）一体脚本。

- 反向代理访问你的 Emby 服务器（隐藏真实地址，面板化管理多节点）
- 下载时自动执行伪装观看：模拟真实播放器心跳（每 10s 上报一次进度），60~300s 随机停止并删除播放记录
- 自动/手动保活：隔 N 天自动模拟观看一次，保持账号活跃
- **IP 访问控制**：全局白/黑名单、IP/CIDR 网段、国家码整体封锁，被拦可 302 跳转或显示禁用页；`/entry` 逃生入口 + 最高白名单兜底
- 绑定 Durable Objects 后执行完整 90~300s 真实心跳模拟播放，不受 CF 单请求 30s 墙钟限制
- **测速页预设优选源 30 源**：分组下拉（云枢全域与三网专线、104/162/172 大段家族、198&108 专线、IPv6 霄汉星轨 12 源、第三方备用），来源详情条显示名字/标识/完整 API 地址，点击一键复制
- **综合混合源四源并发**：并发聚合 uouin + cf-speed-dns + 164746 + wetest，提取结果提示显示来源名
- **TG 签到面板**（本版内置）：多站 Telegram Bot 自动签到，和主面板共用登录与通知，**每天只排一次班、班次时间落在设定时间段内随机（精确到秒）**

当前版本：**3.8.27**（签到改为「一天排一次班 + 时间段内随机秒」；完整变更见 [changelog.json](changelog.json)）

> **本文档有两个部署方式**：
> [方法一 · 手动部署](#二方法一手动部署网页操作--一条命令建-do)（网页点点点，最后用一条命令把 DO 建出来）
> [方法二 · 自动部署](#三方法二自动部署推荐)（脚本一键 / wrangler / GitHub Actions）

---

## 一、准备工作

1. 一个 Cloudflare 账号（免费版即可，Durable Objects 免费版支持 **SQLite 类**）
2. 新建一个 **D1 数据库**：Dashboard → **存储和数据库 / Storage & Databases** → **D1 SQL 数据库** → 创建 → 名字随意（如 `myemby`）→ 建好后复制 **Database ID（UUID）**
   - **不需要手动建表**：Worker 第一次被访问时会自动 `CREATE TABLE IF NOT EXISTS` 建好全部表
3. （自动部署需要）一个 **API Token**：Dashboard → 我的个人资料 → API 令牌 → 创建令牌 → 自定义令牌，权限给：
   - `账户 / Workers Scripts / 编辑`
   - `账户 / D1 / 编辑`
   - （想脚本自动绑自定义域再加 `区域 / Workers 路由 / 编辑` + `区域 / DNS / 编辑`）

---

## 二、方法一：手动部署（网页操作 + 一条命令建 DO）

> 为什么最后要"一条命令"？**Durable Object 命名空间只能由部署时的 `migrations` 创建**，网页编辑器的「保存并部署」不带 migrations，所以你在绑定页的下拉里是搜不到 `KeepAliveDO` 的。这一步绕不过去，但只做**一次**。

### 2.1 建 Worker 并上传代码

1. Dashboard → **Workers & Pages** → **创建 / Create** → **Worker** → 名字随意（如 `emby`）→ 部署（先出个 Hello World）
2. 进入该 Worker → **编辑代码 / Edit code** → 全选删除 → 粘贴 `worker.js` 全部内容 → **部署 / Deploy**
   - 文件 1.2MB 左右，粘贴慢是正常的
   - 如果自行混淆：**必须保留 `export class KeepAliveDO`、`export default`、变量名 `KEEPALIVE_DO`**，否则 DO 永远绑不上

### 2.2 设置运行时兼容性

Worker → **设置 / Settings** → **运行时 / Runtime**：

| 项 | 值 |
| --- | --- |
| 兼容性日期 / Compatibility date | `2024-09-23` |
| 兼容性标志 / Compatibility flags | `nodejs_compat` |

### 2.3 添加变量与 D1 绑定

**设置 → 变量和密钥 / Variables and Secrets**：

| 类型 | 名称 | 值 | 必需 |
| --- | --- | --- | --- |
| 密钥 Secret | `ADMIN_TOKEN` | 你的面板管理密码 | ✅ |
| 文本 Text | `CF_WORKER_NAME` | 这个 Worker 的名字（如 `emby`） | ✅ |
| 文本 Text | `CF_ACCOUNT_ID` | 账户 ID（Dashboard 右侧栏可复制） | ✅ |
| 文本 Text | `CF_DOMAIN` | 自定义域，如 `tv.example.com`（不绑可不填） | ⬜ |
| 文本 Text | `CF_ZONE_ID` | 该域名的 Zone ID | ⬜ |
| 密钥 Secret | `CF_API_TOKEN` | 面板里「清缓存 / 检查更新」用，可留空 | ⬜ |

**设置 → 绑定 / Bindings → 添加 → D1 数据库**：

- 变量名：`DB`
- 选择你在准备阶段建的那个库

改完点保存（此时页面可能提示需要重新部署，正常）。

### 2.4 建出 Durable Object（关键一步，三选一）

**方案 A：新版面板自带按钮**

设置 → 绑定 → 添加 → **Durable Objects** → 如果命名空间下拉底部有「**创建新命名空间 / Create new namespace**」：

- 变量名：`KEEPALIVE_DO`
- 类名：`KeepAliveDO`
- 保存 → 重新部署

有按钮就到这一步为止，跳过方案 B/C。

**方案 B：用附带脚本（推荐，成功率 100%）**

本地下载仓库里的 `worker.js`，再执行（Linux / macOS / WSL；Windows 用 Git Bash 或 PowerShell 里的 bash）：

```bash
CF_API_TOKEN=你的Token \
CF_ACCOUNT_ID=你的账户ID \
D1_ID=你的D1-UUID \
WORKER_NAME=你的Worker名字 \
ADMIN_TOKEN=你的面板密码 \
sh deploy.sh ./worker.js
```

脚本会：判断是不是首次部署 → 首次带上 `migrations.new_sqlite_classes: ["KeepAliveDO"]` 创建命名空间并顺带绑好 `DB` / `KEEPALIVE_DO` / 全部变量 → 写入 `ADMIN_TOKEN` 密钥 → 设好 cron → 打开 workers.dev 访问 → 打印面板地址。

**方案 C：wrangler 一行**

```bash
npx wrangler deploy    # 用仓库自带的 wrangler.toml（已含 migrations）
```

首次部署后，Dashboard 的绑定下拉里就能看到 `<你的Worker名>_KeepAliveDo`，后续想用网页改绑定/换代码都可以。

### 2.5 加 cron 触发器（保活兜底）

Worker → **设置 → 触发器 / Triggers → Cron 触发器 → 添加**：`0 * * * *`

> 保活主要靠「有人访问面板/代理」触发（1 小时节流），cron 只是没人访问时的兜底；签到面板的排班由 DO 自己设 alarm，cron 挂了也不影响。

### 2.6 首次访问

打开 `https://<worker>.workers.dev`（或你绑的自定义域），用 `ADMIN_TOKEN` 登录。第一次访问会自动建表，等几秒刷新即可。

### 2.7 绑自定义域（可选）

Worker → **设置 → 域和路由 / Domains & Routes → 添加 → 自定义域**，填 `tv.example.com`（域名要已托管在同一个 CF 账号）。绑好后把 `CF_DOMAIN` / `CF_ZONE_ID` 变量补上。

---
## 三、方法二：自动部署

### 3.1 一键脚本（纯 API，不用装 Node / wrangler）

只依赖 `curl` + `jq`，Windows 用 Git Bash / WSL 也能跑。

```bash
# 1) 把 worker.js 和 deploy.sh 放同一个目录
# 2) 填好五个变量后执行
CF_API_TOKEN="你的 API Token" \
CF_ACCOUNT_ID="你的 Account ID" \
D1_ID="D1 数据库 UUID" \
WORKER_NAME="myemby" \
ADMIN_TOKEN="面板密码" \
sh deploy.sh ./worker.js
```

脚本做的事：判断是首次还是更新 → 首次带 `migrations` 建出 `KeepAliveDO` 命名空间并绑定 `KEEPALIVE_DO`、`DB` 和文本变量 → 写入 `ADMIN_TOKEN` 密钥 → 设 cron `0 * * * *` → 打开 `workers.dev` 访问 → 打印面板地址。

> 想同时把 `CF_API_TOKEN`（面板里做 DNS/缓存操作用）也写进去，多加一个环境变量 `CF_API_TOKEN_FOR_PANEL="..."`；要绑自定义域就先别管，绑完再补 `CF_DOMAIN` / `CF_ZONE_ID`。

### 3.2 Wrangler（有 Node 环境的话最省心）

```bash
npm i -g wrangler
wrangler login

# wrangler.toml 已附在仓库里，改掉 name / database_id 即可
wrangler secret put ADMIN_TOKEN     # 交互输入面板密码
wrangler deploy                     # 首次会自动建命名空间并绑定 DO
```

`wrangler.toml` 关键三段（少一段就建不出 DO）：

```toml
[[d1_databases]]
binding = "DB"
database_name = "myemby"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[durable_objects.bindings]]
name = "KEEPALIVE_DO"
class_name = "KeepAliveDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["KeepAliveDO"]   # 免费版必须 sqlite 类
```

### 3.3 GitHub Actions（推代码即部署）

仓库 Settings → Secrets 里加 `CF_API_TOKEN`、`CF_ACCOUNT_ID`、`D1_ID`、`ADMIN_TOKEN`，再放 `.github/workflows/deploy.yml`：

```yaml
name: deploy
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          command: deploy
```

首次跑之前先手动 `wrangler deploy` 一次（让 `v1` 迁移落地），之后 CI 每次跑的都是同一 `tag`，不会冲突。

---
## 四、为什么 DO 必须"先建后用"

Durable Object 命名空间（namespace）是**账号级资源**，它只能由**部署时附带的一次 migration** 创建，代码本身带不来：

- 网页里「粘贴代码 → 部署」= 只上传脚本，不跑 migration，命名空间不存在；
- 之后去「绑定 → Durable Object」，命名空间下拉是空的 / 选不到 `<worker>_KeepAliveDO`，于是绑不上；
- 反过来，命名空间一旦建好，**再部署就不要再带 migration**（带了会报 tag 冲突，整次上传失败）。

一句话记法：**第一次用带 migration 的方式部署（见 2.4 的 B / C，或第三章），以后随便怎么传。**

| 报错 | 真因 | 解法 |
|---|---|---|
| `Cannot create binding to a Durable Object namespace that does not exist` | 从没跑过带 migration 的部署 | 按 2.4-B 跑一次脚本，或 `wrangler deploy` |
| `Cannot apply new migrations. Please use a new tag` / 412 `tag mismatch` | 更新时又带了 `migrations` | 去掉 `migrations` 再传（deploy.sh 会自动重试） |
| `new_classes` 报"需要付费计划" | 免费版只支持 SQLite 存储的 DO | 必须写 `new_sqlite_classes` |
| 面板保活显示已开启但一直不跑 | DO 绑定名不是 `KEEPALIVE_DO`，或类名不是 `KeepAliveDO` | 绑定名/类名要一字不差 |
| `no such table: routes` | 首次请求没打进去（表没自动建） | 先访问一次首页 `GET /`，会自动 `CREATE TABLE IF NOT EXISTS` |

## 五、更新代码的正确姿势

| 场景 | 做法 |
|---|---|
| 用 Dashboard 更新 | 直接编辑代码 → 粘贴新版 → 部署即可。绑定、变量、cron 都会保留，**不用带 migration** |
| 用 deploy.sh 更新 | 直接重跑，脚本识别到脚本已存在就自动去掉 migration |
| 用 wrangler 更新 | `wrangler deploy`，`tag = "v1"` 保持不动（别再改 tag） |
| 换 D1 | 改 `DB` 绑定的目标库，数据不会自动迁移，需自行导出/导入 |
| 换 DO 命名空间 | 等于把保活任务全部丢掉重来（每个 `ka-<playSessionId>` 实例状态都在里面）；签到侧的班次会在下次 cron 重排 |

---
## 六、绑定与变量一览

| 类型 | 名称 | 必填 | 说明 |
|---|---|---|---|
| 密钥 | `ADMIN_TOKEN` | ✅ | 管理员密码，登录面板用；也是加密 TG 会话的派生密钥，**改了会导致已存账号解不开** |
| 变量 | `CF_WORKER_NAME` | ✅ | 当前 Worker 名字，面板自更新/清理缓存要用 |
| 变量 | `CF_ACCOUNT_ID` | ✅ | 账号 ID（概览页右侧） |
| 变量 | `CF_DOMAIN` | 建议 | 面板域名，如 `tv.example.com` |
| 变量 | `CF_ZONE_ID` | 建议 | 域名所在 zone 的 ID |
| 密钥 | `CF_API_TOKEN` | 可选 | 面板内做 DNS / 缓存 / 路由操作用的 Token |
| 绑定 | `DB` | ✅ | D1 数据库 |
| 绑定 | `KEEPALIVE_DO` | ✅ | Durable Object，类名 `KeepAliveDO` |
| 变量 | `TG_BOT_TOKEN` / `TG_CHAT_ID` | 可选 | 通知用 Telegram Bot |
| 变量 | `BARK_KEY` / `BARK_LEVEL` | 可选 | 通知用 Bark |
| 变量 | `KA_ENABLED` | 可选 | `true` 时保活默认开启 |

> 表不用手建，Worker 首次被访问时会自动 `CREATE TABLE IF NOT EXISTS`。

## 七、保活功能

### 自动保活
节点开启保活后，只要有客户端播放，Worker 就会创建一个 `ka-<playSessionId>` 的 DO 实例按时续期，让"观看中"状态一直挂着。检查由 cron（每小时）和面板/反代访问共同驱动，断掉后会自动重建。

### 手动保活
面板 → 节点 → 保活 → 手动开始/停止。停止时会 `deleteAlarm`，不会残留。

### 保活全局 UA / ID
设置 → 保活里可以统一指定 UA 和 DeviceId，避免各节点上报的设备信息五花八门被服务端识别。

### 下载伪装观看
面板里"下载"会按媒体时长伪造播放进度（视频默认 30 分钟，音乐 60 分钟），进度按实际经过时间推进。

## 八、IP 访问控制

支持**白名单 / 黑名单 / 国家封锁**三种模式，按 `CF-Connecting-IP` 与 `request.cf.country` 判断，命中即返回"访问已被禁止"页面（面板和反代都生效）。

> 注意：开着白名单时如果用 `*.workers.dev` 调试，记得把自己的出口 IP 或国家加进去，否则会看到那张禁止页。

---
## 九、TG 签到面板（本版已合入）

访问 `/tg` 用同一个 `ADMIN_TOKEN` 登录（主面板登录后自动带 SSO，不用再输密码）：

- 任务按「一天排一次班」调度：统一时间段内随机一个**秒级**时刻执行，跑完自动排明天的班次，所以 cron 只当兜底看门狗；
- 通知走主面板的通知配置（Bark / Telegram）；
- 与主面板共用 D1 和 DO，不需要额外变量或绑定。

## 十、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 页面一直"加载中"、按钮没反应 | JS 报错，先看浏览器控制台；多半是用了被改坏的 worker.js（模板字符串里的转义被吃掉） |
| 面板能开但登录失败 | `ADMIN_TOKEN` 没设，或设在了旧 Worker 上；重新部署后要再检查一次绑定 |
| 保活不生效 | 看节点是否开启保活、`KEEPALIVE_DO` 是否绑定；`/` 访问一次让 cron/请求驱动重新起任务 |
| 想恢复出厂 | 删掉 D1 里的 `app_config` 行（或重建库），重新访问即写默认值 |
| 换域名 | 改 `CF_DOMAIN`，并在 Domains & Routes 里把旧的移除、新的加上 |

## 十一、版本

当前版本 **v3.8.27**（`worker.js` 单文件，约 1.2 MB）。历史更新日志见仓库 `changelog.json`。

## 免责声明

本项目仅用于**个人学习与技术研究**（Cloudflare Workers 反向代理、Durable Objects 保活、D1 存储实践）。请勿用于任何商业用途或侵犯他人权益的场景；使用产生的一切后果由使用者自行承担。若相关服务方明确禁止此类行为，请立即停止使用并删除部署。
