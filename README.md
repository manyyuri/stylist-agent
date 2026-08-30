# 小PD · 女团风形象管家 Agent

> 每日 OOTD · 妆造模板 · 独拍计划 · 拍后复盘 —— 基于真实衣橱的本地优先 AI 形象管理闭环。
> 手机优先（iPhone Safari 直连），全部数据留在自己电脑上。

## 功能一览

| 模块 | 能力 |
| --- | --- |
| 今日 | 天气感知 OOTD（单品拼贴 + 女团感叙事 + 妆造步骤 + 拍照提示 + 备选），反馈闭环（就穿这套/一般/没穿 → 反哺权重） |
| 衣橱 | 拍照入库：AI 视觉识别草稿 → 人工确认入库；品类/季节筛选、编辑、出片分与穿着次数统计 |
| 拍照 | 独拍计划：地理编码 + 日照计算黄金/蓝调时刻，LLM 分镜（引用姿势库 24 个编号姿势，防幻觉），拍后上传样片 + 视觉复盘（精选/可用/废片 + 出片配色反哺单品评分）。**支持小红书链接/参考图生成**：粘贴链接或上传截图 → 视觉模型分析封面/全部图 → 提炼风格简报 → 自动生成分镜 |
| 档案 | 身材/肤色/脸型/眼型档案，6 个女团风格锚点多选 + 排序（优先级），自拍分析（仅建议、确认后写入） |
| 小PD | 流式对话 Agent：9 个工具（天气/衣橱查询/OOTD 生成/反馈/妆造推荐/计划创建/复盘），工具结果渲染成结构化卡片而非纯文本 |

## 技术栈与设计

**后端**（Node 20+，ESM + TypeScript，零 ORM）

- **Express 5** REST（profile/wardrobe/weather/OOTD/plans）
- **Flue Agent Runtime**：DeepSeek（opencode-luna 网关）+ 持久化会话、工具调用、恢复与事件流；同一模型同时处理文本与图片
- **zod 4** 定义工具参数 → `z.toJSONSchema()` 生成 function calling schema，强校验防幻觉
- **规则引擎 + LLM 混合编排**（cook5 哲学）：结构合法性（top+bottom / dress、类别覆盖、温度桶 0-10/10-24/24-40、正式度匹配、色彩和谐 HSL 色距、锚点匹配、穿着频率惩罚）由确定性代码保证，LLM 只负责挑选与叙事 —— **LLM 永远无法编造不存在的单品**
- **sharp 图片管线**：EXIF 方向转正 → 限宽 1280px JPEG（原图留 `orig/` 不对外）
- **open-meteo** 免费天气/地理编码（当日缓存 + 手动降级）；黄金/蓝调时刻由本地天文算法计算
- **node:test** 零依赖测试（26 个用例：规则引擎 + 日照计算）
- 原子写 JSON（tmp + rename + 锁），数据目录 `~/stylist-data`

**前端**（React 19 + Vite 7）

- **antd 6** 组件体系 + **@ant-design/x 2**（BubbleList/Sender 构建 AI 对话）
- **zustand 5** version 自增刷新模式（跨页数据联动）
- 移动端底部 Tab、安全区适配、触控目标 ≥44px、单卡式信息架构
- 工具卡片范式：SSE `tool-result.payload` 按类型渲染成穿搭卡/计划卡（ChatGPT Plugins / Cursor 同款交互）

**AI 降级设计**：未配置 LLM key 时一切可用 —— OOTD 走规则引擎 + 模板叙事，拍照计划走 shots.md 兜底分镜，衣橱识别降级为手动填写，对话返回友好提示。

## 快速开始

```bash
# 1. 安装依赖（根目录 + web + Flue）
npm install
cd web && npm install && cd ..
cd flue && npm install && cd ..

# 2.（可选但推荐）配置 LLM key —— 不配也能跑（见降级说明）
# 自动读取 ~/.pi/agent/models.json 的 opencode-luna apiKey；也可显式注入：
export GLM_API_KEY=xxx
# 默认网关 https://opencode.ai/zen/go/v1（OpenAI 兼容，DeepSeek 模型）：
# 文本 deepseek-v4-flash / 视觉 deepseek-v4-flash-vision-exp；可用 GLM_BASE_URL 覆盖

# 3. 一键构建 + 启动
npm start          # 构建 web + Flue，并同时启动 Express:4290 与 Flue:4291
```

开发模式（前后端热更）：

```bash
npm run dev:server   # 根目录：tsx watch，端口 4290
npm run dev:flue     # Flue Agent Runtime，端口 4291
npm run dev:web      # web 目录：vite，端口 5173（/api、/workspace → 4290，/agents → 4291）
```

配置见 `config.json`（端口、数据目录、默认城市坐标）。Flue Agent 端口默认为 4291；`FLUE_URL` 可覆盖内部 dispatch 地址。每日 OOTD 调度默认开启（`npm start` 即生效；开发环境想关掉设 `STYLIST_DISABLE_SCHEDULER=1`）。拍照样片上传后会自动 dispatch durable Photo Review Agent，Flue 不可用时仍可在拍照页手动复盘。

## 小红书链接 → 拍摄计划

拍照页 → 新建企划 → 选「小红书链接」（或「参考图」）→ 粘贴链接/上传截图 → 自动分析生成分镜。

抓取原理与降级链：

1. **服务端 cookies 抓取**（主路径）：app「复制链接」得到的链接带 `xsec_token`，配合登录 cookies 能取到**完整笔记与全部图片**（`__INITIAL_STATE__`）。cookies 从浏览器扩展导出的 `cookies.txt` 读取（路径配在 `config.json` 的 `xhsCookieFile`，默认 `~/Downloads/www.xiaohongshu.com_cookies.txt`），值不进 git。
2. **多图综合分析**：笔记全部图片（最多 6 张）一起喂给视觉模型，提炼配色/穿搭/场景/表情基调 → 注入分镜创意；计划详情页保留整组参考图。
3. **分享文字兜底**：链接抓不到时粘贴「分享文字」，文本模型提炼。
4. **chrome-devtools-axi 兜底**（可选）：cookies 失效时，用 `scripts/xhs-browser-dump.mjs` 连真实 Chrome（已登录、家庭 IP，能过小红书 IP 风控）提取完整笔记导出到 `~/stylist-data/xhs-notes/<noteId>.json`，服务端自动优先读取。需先给 Chrome 开远程调试：`open -a "Google Chrome" --args --remote-debugging-port=9222`。

## 手机访问（核心使用场景）

**同一 WiFi**：启动时控制台会打印局域网地址，iPhone Safari 直接打开

```
http://192.168.x.x:4290
```

**外出使用 / 跨网络（Tailscale，推荐）**：

```bash
# 电脑和 iPhone 都安装 Tailscale 并登录同一账号（App Store 免费）
brew install --cask tailscale   # macOS；iPhone 装 Tailscale App
# 启动后设备获得 100.x.x.x 虚拟 IP，手机 Safari 访问：
# http://<电脑的-tailscale-ip>:4290
```

建议「添加到主屏幕」，获得全屏 PWA 体验。

## 数据与目录

```
~/stylist-data/
├── profile.json              # 档案（含锚点排序）
├── wardrobe.json             # 衣橱单品索引
├── ootd/YYYY/MM-DD.json      # 每日穿搭（current + history 供换一套排除）
├── wardrobe/photos/...       # 单品照（压缩版 + orig/ 原图）
├── plans/<plan-id>/          # 每个拍照计划一目录
│   ├── plan.json             # 分镜/时间窗/清单
│   └── shots/                # 样片 + review.json 复盘结果
└── weather-cache.json        # 当日天气缓存
```

`orig/` 目录不对外提供（静态托管 403），仅保留原图备份。

## 测试

```bash
npm test          # 26 个用例：规则引擎（候选/评分/校验）+ 日照计算
npm run typecheck # 前后端 tsc
```

## 项目结构

```
├── server/
│   ├── index.ts            # Express 入口（静态托管 + REST 路由）
│   ├── tools.ts            # 9 个业务工具（Flue adapter 复用 zod 校验 + handler）
│   ├── scheduler.ts        # 每日 OOTD 调度（默认开，STYLIST_DISABLE_SCHEDULER=1 关闭）
│   ├── start.ts            # 生产环境同时启动 Express 与 Flue
│   ├── rules.ts            # 规则引擎（候选生成/评分/校验）★核心
│   ├── ootd.ts             # OOTD 混合编排（规则选品 + LLM 叙事）
│   ├── plans.service.ts    # 拍照计划（地理编码 + LLM 分镜 + 兜底）
│   ├── review.service.ts   # 视觉复盘 + 出片反哺
│   ├── vision.ts / llm.ts  # DeepSeek 多模态 / chatJSON(zod 校验+重试)
│   ├── weather.ts / sun.ts # open-meteo + 黄金时刻天文计算
│   └── routes/             # REST 路由
├── flue/
│   ├── src/app.ts          # Flue provider 与 Agent route
│   ├── src/agents/stylist.ts # 小PD 主 Agent
│   └── vite.config.ts      # Flue Node runtime 构建
├── web/src/
│   ├── pages/              # 今日/衣橱/拍照/档案/小PD 5 页
│   ├── components/         # OutfitCard（今日页与对话卡复用）
│   ├── api/                # request/upload 封装 + SSE 消费
│   └── stores/             # zustand
├── knowledge/              # 知识库：6 锚点卡 / 8 妆造模板 / 24 姿势 / 5 场景分镜 / 色彩
└── shared/types.ts         # 前后端共享数据模型
```
