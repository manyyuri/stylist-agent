# stylist-agent 全量替换为 Flue Agent Runtime：AI 实现规格

> 这是一份可直接交给 AI 编程代理执行的实现提示词文档。
>
> 目标：将当前项目中手写的 Agent Loop、OpenAI tool schema、客户端 history 拼接和自定义聊天 SSE，整体迁移到 `https://github.com/withastro/flue`，同时保留现有衣橱、OOTD、拍照计划、视觉复盘和规则引擎能力。
>
> 生成说明：项目根目录 `config.json` 当前没有配置 `output.directory`，因此本文件暂存于 `spec/flue-full-replacement.md`。如需使用 quick-spec 的外部目录，请先在 `config.json` 增加 `output.directory`。

---

## 1. 任务背景

当前项目是一个本地优先的女团风形象管家：

- 后端：Node.js + Express 5 + TypeScript + JSON 文件存储
- 前端：React 19 + Vite 7 + Ant Design 6 + `@ant-design/x` 2
- 模型：智谱 GLM-5.3-Flash（文本与多模态统一模型）
- 数据目录：`~/stylist-data`
- 聊天接口：`POST /api/chat`，自定义 SSE
- Agent：`server/agent.ts` 手写最多 8 轮的 OpenAI-compatible function calling loop
- 工具：`server/tools.ts` 中使用 Zod 定义参数并转换为 OpenAI tools

需要接入 Flue，但不是新增一个并行聊天框架。目标是让 Flue 成为唯一的 Agent 编排、会话、事件流和任务运行时。

### 全量替换定义

迁移完成后，下列能力必须由 Flue 承担：

1. Agent 定义与注册
2. 模型调用
3. 工具注册与调用
4. 多轮工具调用循环
5. 会话历史和 Agent instance
6. 中断、失败恢复和重试
7. Agent 事件流
8. Agent HTTP endpoint
9. Agent 主动任务入口

下列能力继续由现有业务代码承担：

1. 衣橱、档案、OOTD、拍照计划、复盘等领域逻辑
2. 规则引擎和数据校验
3. JSON 文件读写和图片处理
4. REST 业务接口
5. React 页面和业务卡片展示

不要把 Flue 当作数据库、业务规则引擎或任意文件操作层。

---

## 2. 必须先阅读的代码

实现前必须完整阅读以下文件，并在修改前确认调用关系：

### Agent 和工具

- `server/agent.ts`
- `server/tools.ts`
- `server/prompts.ts`
- `server/llm.ts`
- `server/vision.ts`
- `server/routes/chat.ts`

### 业务服务

- `server/ootd.ts`
- `server/rules.ts`
- `server/plans.service.ts`
- `server/review.service.ts`
- `server/weather.ts`
- `server/knowledge.ts`
- `server/store.ts`
- `shared/types.ts`

### 前端聊天链路

- `web/src/api/chatStream.ts`
- `web/src/pages/ChatPage/index.tsx`
- `web/src/components/OutfitCard.tsx`
- `web/src/stores/index.ts`
- `web/src/types/index.ts`

### 构建和配置

- `package.json`
- `web/package.json`
- `web/vite.config.ts`
- `tsconfig.json`
- `README.md`
- `config.json`

---

## 3. 目标架构

采用单一 Agent Runtime 架构：

```text
React / Ant Design X
        │
        │ Flue SDK 或 Flue-compatible stream
        ▼
Flue Agent Runtime
        │
        ├── Stylist Agent
        ├── Daily Outfit Agent
        ├── Photo Review Agent
        └── optional subagents
        │
        ▼
框架无关的业务工具层
        │
        ├── profile service
        ├── wardrobe service
        ├── outfit service
        ├── makeup service
        ├── photo plan service
        └── review service
        │
        ▼
现有 JSON / 图片数据目录
```

推荐运行方式：

- Flue 与 Express 在同一个 Node 进程内运行，优先尝试统一构建和端口
- 如果当前 Flue Vite plugin 与 Express 入口无法稳定共存，则使用两个进程：
  - Express：`4290`
  - Flue：`4291`
- 不允许引入第三个重复的业务 API server
- 生产环境通过反向代理将 `/agents/*` 转给 Flue

全量替换不等于删除 Express。Express 仍然是 profile、wardrobe、weather、ootd、plans 和 workspace 图片的业务 HTTP 层。

---

## 4. 依赖与版本策略

在根目录或独立 Flue workspace 中加入并锁定 Flue 依赖：

```json
{
  "dependencies": {
    "@flue/runtime": "2.0.3",
    "@flue/cli": "2.0.3",
    "@flue/vite": "2.0.3",
    "@earendil-works/pi-ai": "^0.83.0",
    "valibot": "^1.0.0"
  }
}
```

实际安装前通过 npm 核实最新稳定版本；不要直接依赖 GitHub `main`。

建议采用 workspace：

```text
package.json                 # workspace 根
server/                      # 现有业务后端
web/                         # 现有 React 前端
flue/                        # Flue Agent 应用
  ├── src/agents/stylist.ts
  ├── src/agents/daily-outfit.ts
  ├── src/agents/photo-review.ts
  ├── src/tools/
  ├── src/app.ts
  ├── package.json
  ├── tsconfig.json
  └── vite.config.ts
```

如果 workspace 会导致现有 NodeNext 配置或构建冲突，可以把 Flue 应用放在根目录 `flue/`，但必须确保它可以导入根目录的 `server` 和 `shared` 代码，或者通过独立的共享包导出业务服务。

---

## 5. 业务层重构要求

### 5.1 从 OpenAI tool registry 中抽离业务函数

当前 `server/tools.ts` 同时包含 Zod schema、OpenAI schema 转换和业务 handler。需要拆分为：

1. 框架无关的业务函数
2. Flue tool adapter
3. 旧 OpenAI adapter（迁移完成后删除）

推荐结构：

```text
server/
├── services/
│   ├── profile.service.ts
│   ├── wardrobe.service.ts
│   ├── outfit.service.ts
│   ├── makeup.service.ts
│   ├── photo-plan.service.ts
│   └── photo-review.service.ts
├── agent-tools/
│   ├── types.ts
│   ├── query-wardrobe.ts
│   ├── generate-outfit.ts
│   ├── recommend-makeup.ts
│   ├── create-photo-plan.ts
│   └── review-photo-session.ts
```

不要求机械拆成很多文件，但必须满足：业务函数不能依赖 `OpenAI.Chat.Completions` 类型、SSE emit 或 Flue runtime。

### 5.2 工具的安全边界

Flue Agent 默认不得使用 bash、任意 filesystem sandbox 或直接修改 `~/stylist-data`。

Agent 只能通过业务工具访问真实数据：

- `get_profile`
- `query_wardrobe`
- `get_weather`
- `generate_outfit`
- `log_outfit_feedback`
- `recommend_makeup`
- `create_photo_plan`
- `review_photo_session`
- `wardrobe_gap_check`

工具必须继续使用服务端规则校验。模型只负责选择工具和表达，不负责保证领域约束。

### 5.3 保留规则引擎的最终权威

以下规则必须继续在服务端确定性执行：

- 真实单品 ID 存在性
- top + bottom 或 dress 结构
- 季节和温度桶匹配
- 正式度匹配
- 颜色和谐
- 风格锚点匹配
- 穿着频率惩罚
- 图片和计划数据的结构合法性

禁止将这些规则改写成 system prompt 后交给模型自行遵守。

---

## 6. Flue Agent 设计

### 6.1 主 Agent

创建：

```text
flue/src/agents/stylist.ts
```

Agent 名称：`Stylist`。

职责：

- 处理用户对话
- 调用衣橱、档案、天气、OOTD、妆造和拍摄工具
- 维持连续会话
- 通过结构化工具结果让前端继续渲染业务卡片

Agent 必须包含以下约束：

```text
涉及用户真实衣橱时，必须先调用 query_wardrobe 或 get_profile。
不得编造不存在的衣橱单品、图片、计划 ID 或天气数据。
生成穿搭必须调用服务端规则引擎。
所有写操作必须经过工具，不得直接修改文件。
工具失败时必须明确告知用户，不得假装成功。
```

### 6.2 模型 provider

当前模型配置来自 `config.json`：

```json
{
  "models": {
    "text": "glm-5.3-flash",
    "vision": "glm-5.3-flash"
  }
}
```

当前项目改为使用 `GLM_API_KEY`（兼容 `ZHIPU_API_KEY`）。API endpoint 默认采用 `~/.pi/agent/models.json` 中 glm provider 的：

```text
https://open.bigmodel.cn/api/coding/paas/v4
```

GLM-5.3-Flash 同时承担文本和视觉输入，不再需要 qwen vision 模型。Flue provider 迁移时应复用这套 provider 配置。

实现要求：

1. 优先复用 DashScope 的 OpenAI-compatible endpoint
2. 明确配置 base URL、API key、模型名
3. 如果 Flue provider 无法直接支持 DashScope，新增最小 provider adapter
4. provider 配置不得把 API key 打包到前端
5. 保留无 API key 时的业务降级能力

无模型时：

- `/api/ootd` 等已有业务 API 继续可用
- Flue Agent 返回清晰的离线提示
- 不能因 Flue 初始化失败导致 Express 业务 API 无法启动

### 6.3 视觉输入

当前聊天附图流程在 `server/agent.ts` 中调用 `extractItems()`，并将识别草稿注入用户消息。

迁移后有两种合法实现，优先第一种：

1. Flue Agent 接收 attachment/image input，再调用一个受限的 `inspect_clothing_images` 工具
2. 保留一个 HTTP adapter，在进入 Flue session 前调用 `extractItems()`，将结果作为结构化上下文注入

要求：

- 视觉识别结果仍然是草稿，不能自动入库
- 每次最多处理 3 张图片
- 图片大小和类型限制必须保留
- 原图不能被 Agent 通过 sandbox 读取
- 识别失败必须是可解释的工具错误

---

## 7. 工具迁移清单

### `get_profile`

读取 `getProfile()`。

- 参数：无
- 副作用：无
- 返回：`Profile`

### `query_wardrobe`

迁移当前 `server/tools.ts` 的筛选行为。

- `categories`
- `seasons`
- `colorFamily`
- `tags`
- `itemId`
- 必须只返回真实单品
- 返回内容控制大小，避免将图片和原图数据塞回模型

### `get_weather`

复用 `getWeather()`。

- `date` 可选
- 天气服务失败时返回结构化 fallback
- 不允许模型编造温度和日照窗口

### `generate_outfit`

复用 `composeOotd()`。

- 必须使用真实衣橱
- 保留 `regenerate` 语义
- 结果必须包含可供前端渲染的完整 `Ootd`
- `anchor` 参数如果当前 `composeOotd` 尚未使用，必须明确处理或删除，不要保留无效参数

### `log_outfit_feedback`

复用 `logFeedback()`。

- `liked`
- `meh`
- `unchosen`
- 写操作必须幂等
- 重复投递不能重复增加穿着次数

### `recommend_makeup`

复用 `recommendMakeup()`。

- 输入来自真实 profile
- 返回主推与备选模板
- 不得由模型自行拼接不存在的模板

### `create_photo_plan`

复用 `createPlan()`。

- 地点、日期、主题和场景类型必须经过 schema 校验
- `outfitRef` 只能引用存在的衣橱单品
- 写入计划前检查重复提交
- 返回完整 `PhotoPlan`

### `review_photo_session`

复用 `reviewSession()`。

- `planId` 必须存在
- 重复复盘必须可识别
- 视觉结果写回衣橱评分时保持原子性
- 失败时不能留下半写入状态

### `wardrobe_gap_check`

复用当前缺口计算逻辑。

- 无副作用
- 返回结构化的风格锚点缺口和色盘命中率

---

## 8. 会话模型替换

删除客户端主导的 history 传递：

```ts
history?: { role: 'user' | 'assistant'; content: string }[]
```

Flue instance ID 需要稳定映射到本地用户。当前项目没有登录系统，因此第一版使用本地设备身份：

```text
stylist:<device-id>
```

实现要求：

1. 首次打开时生成随机 device ID
2. 保存到浏览器 localStorage
3. 之后所有请求使用相同 Agent instance ID
4. 不把原始聊天历史放在每次 POST body 中
5. 页面刷新后可以继续上一段会话
6. Abort 后可以重新连接同一个 session
7. 同一设备多标签页需要避免覆盖彼此的会话状态

未来接入登录系统后，instance ID 改为用户 ID，但不得修改业务工具接口。

### 隐私要求

- device ID 不得包含真实姓名、手机号或路径
- 当前本地模式的聊天数据默认保存在本地 runtime
- 不允许将 `~/stylist-data` 整个目录上传到第三方服务
- 生产部署时需要明确 conversation persistence 的存储位置

---

## 9. HTTP 和前端迁移

### 9.1 删除自定义聊天 SSE

迁移完成后删除：

- `server/agent.ts`
- `server/routes/chat.ts`
- `web/src/api/chatStream.ts` 中仅服务于旧 `/api/chat` 的实现
- `server/tools.ts` 中 OpenAI schema 编译逻辑
- `server/llm.ts` 中仅服务于旧 Agent Loop 的代码

删除前必须确认没有其他 route 或测试依赖它们。

### 9.2 前端使用 Flue SDK

优先将 `web/src/api/chatStream.ts` 改造成 Flue client adapter，而不是在页面内直接解析底层协议。

建议接口保持业务化：

```ts
export interface StylistSession {
  instanceId: string;
  send(input: {
    message: string;
    images?: string[];
    signal?: AbortSignal;
  }): AsyncIterable<StylistEvent>;
}
```

页面只消费统一事件：

```ts
export type StylistEvent =
  | { type: 'message'; delta: string }
  | { type: 'tool-call'; id: string; name: string; args?: unknown }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; summary: string; payload?: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' };
```

如果 Flue SDK 已能提供完整的 session stream，则 adapter 只负责字段映射；不要让 `ChatPage` 直接依赖 Flue 内部事件类型。

### 9.3 ChatPage 改造

修改：`web/src/pages/ChatPage/index.tsx`

必须保留：

- `@ant-design/x` 的 `Bubble.List`
- `Sender`
- 图片上传和最多 3 张限制
- 文本流式显示
- 工具调用状态
- `OutfitCard`
- 拍照计划卡片
- Abort 取消
- 空结果提示
- 错误提示

新增：

- 当前 session / instance 状态
- 重新连接状态
- “恢复会话”能力
- Agent 正在恢复任务时的状态提示

不要为了接入 Flue 重做整个聊天 UI，也不要把结构化工具结果降级成纯 Markdown 文本。

### 9.4 Ant Design 使用要求

项目当前使用 Ant Design 6 和 `@ant-design/x` 2。实现前必须以项目安装版本为准查询 API，不要凭记忆添加组件属性。

优先复用已有组件：

- `Alert`：离线、恢复失败、权限错误
- `Tag`：工具执行状态
- `Card`：OOTD 和拍照计划结果
- `Spin`：恢复中
- `Button`：重连、重试
- `Image`：附图预览
- `Typography.Text`：辅助状态文本

遵守现有移动端规则：

- 触控目标不少于 44px
- 适配 iPhone 安全区域
- 不使用只能在桌面端操作的 hover 交互
- 不在聊天消息中嵌套过深的复杂表单

---

## 10. Express 与 Flue 共存/替换方案

优先实现单进程方案：

```ts
// Express app 中挂载 Flue router 的 adapter
app.use('/agents', flueAdapter);
```

如果 Flue 官方 router 只能由它的 Vite 生成入口托管，则采用双进程方案：

```text
npm run dev:server  # Express 4290
npm run dev:flue    # Flue 4291
npm run dev:web     # Vite 5173
```

Vite proxy 增加：

```ts
proxy: {
  '/api': 'http://localhost:4290',
  '/workspace': 'http://localhost:4290',
  '/agents': 'http://localhost:4291'
}
```

生产时由 Express 或反向代理统一暴露入口。不能让浏览器直接依赖开发环境的 4291 地址。

### 启动脚本

新增并保持向后兼容：

```json
{
  "scripts": {
    "dev:flue": "npm --prefix flue run dev",
    "build:flue": "npm --prefix flue run build",
    "build": "npm run build:flue && npm --prefix web run build",
    "start": "npm run build && npm run start:server"
  }
}
```

如果最终是单进程，脚本应相应简化，但 `npm start` 必须仍然能完成一次构建并启动应用。

---

## 11. 主动任务 Agent

全量替换后新增两个 Agent，但可以在主聊天迁移完成后实现。

### Daily Outfit Agent

任务：每天生成当日 OOTD。

步骤：

1. 读取 profile
2. 读取天气
3. 查询真实衣橱
4. 调用规则引擎生成 OOTD
5. 写入当日记录
6. 避免覆盖用户已经手动确认的穿搭

### Photo Review Agent

任务：图片上传完成后自动复盘。

步骤：

1. 验证 planId
2. 读取该计划的样片
3. 调用视觉复盘
4. 写入 review.json
5. 更新衣橱 photoRating
6. 向当前会话发送完成事件

两个 Agent 的写操作都必须设计幂等键。不要使用进程内布尔变量防止重复执行，因为 Flue 的恢复和多实例运行会使其失效。

---

## 12. 错误、取消与恢复

统一错误分类：

```text
validation_error  参数不合法
not_found         衣橱单品、计划或 session 不存在
provider_error    模型服务失败
business_error    规则或业务服务失败
aborted           用户主动取消
runtime_error     Flue runtime 错误
```

要求：

- 工具错误必须回灌给 Agent，让 Agent 可以解释或采取替代动作
- Agent 不得在工具失败后声称已经完成
- 用户主动取消不能显示为服务端 500
- 网络断开后前端可以用同一 instance 恢复
- 写操作重试必须幂等
- Express 业务 API 不得因 Flue provider 不可用而整体退出

---

## 13. 测试要求

### 单元测试

保留并通过：

```bash
npm test
```

覆盖：

- 规则引擎
- 日照计算
- 工具参数 schema
- 工具真实数据约束
- 写操作幂等

新增：

- Flue tool adapter 参数映射
- Flue event 到 `StylistEvent` 的转换
- instance ID 生成与持久化
- 错误分类

### 集成测试

至少覆盖：

1. 无 API key 时业务 API 正常启动
2. 无 API key 时 Flue chat 返回友好离线状态
3. Agent 查询衣橱后不会产生不存在的 item ID
4. Agent 生成 OOTD 可以渲染 `OutfitCard`
5. Agent 创建计划可以渲染计划卡
6. 刷新页面后可以恢复同一 session
7. Abort 后重新发送不会产生重复写入
8. 重复反馈不会重复增加穿着次数
9. `review_photo_session` 重试不会重复污染评分
10. 图片最多处理 3 张
11. `orig/` 目录仍然不能被访问

### 构建和类型检查

```bash
npm run typecheck
npm run build
```

前端必须继续通过 TypeScript build，后端必须保持 NodeNext + strict 配置。

### Ant Design 检查

对修改后的前端文件运行：

```bash
antd lint web/src --format json
```

修复 deprecated、a11y 和错误组件属性问题。不要因为迁移 Agent 而引入没有必要的新 UI 组件。

---

## 14. README 和部署文档更新

更新 `README.md`，说明：

1. Flue 在项目中的职责
2. Express 和 Flue 的端口/进程关系
3. 如何配置 DashScope provider
4. 如何启动开发环境
5. 如何为本地设备生成稳定 instance ID
6. 会话数据保存在哪里
7. API key 缺失时的降级行为
8. 如何恢复中断的拍照复盘
9. 如何运行测试和构建
10. 如何关闭主动任务

示例启动命令必须真实可执行，不能只写伪命令。

---

## 15. 删除清单

只有全部迁移通过并且新链路稳定后，才能删除：

- `server/agent.ts`
- `server/routes/chat.ts`
- `web/src/api/chatStream.ts` 的旧 SSE 实现
- `server/tools.ts` 的 OpenAI tool registry
- `server/llm.ts` 的旧 Agent client 逻辑
- `history` 请求字段及相关拼接逻辑
- `MAX_TURNS` 及旧循环专用代码
- 旧的 tool-call / tool-result SSE 生成逻辑

删除前运行：

```bash
rg "runAgent|toOpenAITools|findTool|/api/chat|history|MAX_TURNS" .
```

搜索结果只能保留迁移文档、兼容层说明或测试中的合法引用。

---

## 16. 验收标准

### 功能验收

- [ ] 用户能在聊天页发送消息并获得流式回复
- [ ] Agent 能调用所有现有业务工具
- [ ] Agent 不会编造衣橱单品
- [ ] OOTD 卡片和拍照计划卡片仍然正常渲染
- [ ] 图片识别仍然支持最多 3 张
- [ ] 用户刷新页面后仍可继续会话
- [ ] 用户取消后可重连
- [ ] 每日任务可以单独运行
- [ ] 拍后复盘可以恢复和重试
- [ ] 无 API key 时规则引擎和业务页面仍然可用

### 工程验收

- [ ] 生产代码不再包含旧 Agent Loop
- [ ] 业务服务不依赖 Flue 类型
- [ ] Flue tools 不直接操作 JSON 文件
- [ ] 所有写操作可幂等重试
- [ ] API key 只存在服务端
- [ ] Express 业务 API 不依赖模型服务才能启动
- [ ] `npm test` 通过
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `antd lint web/src --format json` 无新增严重问题
- [ ] README 与实际启动方式一致

### 体验验收

- [ ] 手机 Safari 可用
- [ ] 断网/恢复时状态可理解
- [ ] 工具执行不是无反馈黑盒
- [ ] 错误不是裸堆栈
- [ ] 结构化结果仍然是业务卡片，不退化成 JSON 文本
- [ ] Agent 的自动化没有破坏用户对衣橱数据的控制

---

## 17. 实施顺序

严格按以下顺序执行，禁止一次性大面积删除旧代码：

### 第一步：建立 Flue 最小应用

- 安装并锁定依赖
- 创建 `Stylist` Agent
- 使用一个只读工具验证 provider
- 验证 Flue dev/build

### 第二步：抽取框架无关业务服务

- 从 `server/tools.ts` 拆出服务函数
- 保留旧 adapter 暂时兼容
- 加测试保证行为不变

### 第三步：迁移只读工具

- profile
- wardrobe
- weather
- wardrobe gap

### 第四步：迁移生成类工具

- generate outfit
- recommend makeup
- create photo plan

### 第五步：迁移写入类工具

- feedback
- photo review
- 幂等和原子写测试

### 第六步：迁移前端聊天协议

- 增加 Flue client adapter
- 保持 `StylistEvent` 业务协议
- 改造 `ChatPage`
- 支持 instance 和恢复

### 第七步：切换默认入口

- `/api/chat` 不再被前端使用
- `/agents/stylist` 成为唯一聊天入口
- 保留短期 fallback

### 第八步：删除旧链路

- 删除旧 Agent Loop
- 删除 OpenAI tool registry
- 删除旧 SSE route
- 删除客户端 history 拼接

### 第九步：加入主动任务

- Daily Outfit Agent
- Photo Review Agent
- scheduler / dispatch
- 运行日志和失败恢复

### 第十步：文档和最终验收

- 更新 README
- 跑全套测试
- 检查数据目录访问边界
- 检查生产构建

---

## 18. 实现原则

1. 不为了接入 Flue 重写已经稳定的规则引擎。
2. 不让模型直接读写用户数据目录。
3. 不用 system prompt 取代服务端业务校验。
4. 不把 Flue 内部事件类型泄漏到 React 页面。
5. 不在没有测试的情况下删除旧 Agent Loop。
6. 不把 provider 配置写进前端。
7. 不把“大家都这么接 Agent 框架”当作技术理由；每个新增层都必须解决会话、恢复、主动任务或可观测性中的明确问题。
8. 迁移之后，Flue 应该成为唯一的 Agent 运行时，而不是和现有手写循环并存形成两套真相。

最终判断标准不是“项目里安装了 Flue”，而是：

> 小PD能否在保持真实衣橱约束的前提下，拥有可恢复的长期会话，并可靠地完成每日穿搭和拍后复盘任务。
