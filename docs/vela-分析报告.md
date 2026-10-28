# vela 项目分析报告（供剧本 Agent 参考）

> 对象：https://github.com/heider-x/vela（AI 长篇小说创作桌面应用）
> 方法：REA `analyze_javascript_application` 静态分析 + 关键源码人工阅读
> 结论先行：vela 的「工作流引擎 + 逆向推演导入 + 叙事一致性库 + 提示词分层」四块设计，和剧本 Agent 的「对标剧解析 → 改写 → 逐集写作 → 质检」几乎一一对应，值得借鉴设计；但它是 GPL-3.0 许可，**只参考思路，不复制代码**。

## 1. REA 静态分析概况

| 项目 | 数值 |
| --- | --- |
| 相关文件 / 解析的 JS·TS 文件 | 296 / 253（1 个解析失败） |
| AST 节点 / 发现项 | 245,185 / 5,105 |
| Electron 窗口 / contextBridge API | 1 / 1（暴露 7 个成员） |
| IPC 操作 | 129 个（125 个字面量通道，4 个动态通道） |
| 主进程 handler | 125 个 |

技术栈：Electron + React 19 + Zustand + Tailwind 4，本地存储 better-sqlite3，RAG 用 LanceDB 向量库，LLM 走 OpenAI 兼容接口（用户自带 Key）。

## 2. 架构要点

```
渲染进程（React）                     主进程（Electron）
├─ stores/workflow-store   ─ IPC ─▶  ├─ ipc-handlers / ipc-validation
├─ services/workflows/*               ├─ repositories/*（SQLite）
├─ services/narrative-consistency/*   ├─ knowledge-base + vector-store（LanceDB）
├─ services/prompt-templates          ├─ llm/*（OpenAI 兼容）
└─ services/agent/*                   └─ mcp/*
```

- **工作流引擎**（`stores/workflow-store`、`services/workflows/*`）：每个流程是一个 `WorkflowDefinition`，由若干 step 组成，step 的 executor 实例化一个 Command 执行，通过 `StepCallbacks` 回报进度、日志与流式输出。支持取消，以及「逐步确认」模式（每步完成后进入 waiting，用户确认后才继续），保留最近 50 次运行记录。
- **架构工作流**：premise（核心设定）→ characters → worldbuilding → synopsis，逐步生成、逐步确认。
- **导入工作流（逆向推演）**`import-workflow.ts`：
  1. 拆分章节写入正文，同时建知识库；
  2. 按主题（世界观 / 主角 / 冲突 / 风格）向量采样，AI 推演全局设定与角色；
  3. AI 按章推演蓝图，蓝图入向量库，拼装轻量全局摘要；
  4. 刷新 UI 状态。
- **叙事一致性**（`narrative-consistency/`）：canon-store 维护时间线、人物状态、剧情线、事实、摘要；`validator.ts` 写完每章做多维检查（地点连续、知情权、时间线顺序、关系连续、物品归属、承接上章结尾、改写事实安全），配合 `auto-fix.ts` 自动修正并回写状态库。
- **版本**：每章保留多份草稿，可回看、切换。
- **提示词注册表**（`prompt-templates.ts`）：内置模板 → 全局覆盖 → 项目覆盖三层，`getPromptSource` 可知当前生效来源，`renderPrompt` 做变量替换。

## 3. 与剧本 Agent 的对应关系

| 剧本 Agent（PDF / 会议） | vela 对应设计 | 借鉴方式 |
| --- | --- | --- |
| 对标剧拆解：四大板块 + 每集 12 字段 | 导入工作流的逆向推演 | 同样分两层：先全局（梗概 / 人物 / 主线节奏），再逐集（12 字段明细表）；全局推演前先按主题检索原文，而不是整本塞给模型 |
| 审核后一键引用 | 工作流「逐步确认」模式 | 每个板块单独「待审核 → 已确认」，确认后才进入改写上下文 |
| 剧本状态库 / 伏笔包 | canon-store + validator | 每集写前把相关状态注入上下文，写后抽取事实回写；校验维度按短剧改：人设一致、伏笔回收、道具归属、上集钩子承接 |
| 逐集写作（单集或 5 集一批） | chapter-workflow + Command | 每集一个 step，可单集重试，批量时排队执行 |
| 视频逐集转写、自动排队合并 | 工作流引擎的 step 队列与进度回调 | 每集一个转写 step，失败只重跑这一集 |
| 五项自动质检 | validator + auto-fix | 一致性与格式类检查可规则化；节奏 / 卡点对比对标剧数据 |
| 模型可切换、控制 token 成本 | OpenAI 兼容 BYOK | 加一层按环节路由：转写用多模态，拆解 / 写作 / 翻译各配默认模型，记录每步用量 |
| 提示词持续调优 | 三层提示词覆盖 | 内置 → 团队 → 项目，编导可在项目里微调而不影响其他项目 |

## 4. 不建议照搬的部分

- **桌面端形态**：vela 是单机 Electron + 本地 SQLite；剧本 Agent 是团队协作的网站，存储与任务队列应放在服务端。
- **长篇小说的检索策略**：短剧一部 50–80 集、每集 1–2 分钟，文本量小得多，大多数场景整部剧本放进上下文即可，向量库可以后置。
- **129 个 IPC 通道的粒度**：对应到 Web 端是 REST / 任务接口，按「项目 / 环节 / 任务」三类资源设计即可。

## 5. 许可证

vela 采用 **GPL-3.0**。若直接复制或改写其代码，整个产品需以 GPL-3.0 开源。本 Demo 只参考设计思路，未使用其任何代码。

## 6. 分析局限

- REA 只做静态分析：源码按惰性文本解析，未运行应用，运行时注册、可达性均未验证。
- 语义图达到默认节点上限（100,000），覆盖为 partial，仍有 36,423 个语义未知项；4 个动态 IPC 通道未解析；`index.html` 与一个测试 demo 页的内联脚本未分析。
- 因此「没发现某功能」不代表不存在。上面的结论以人工源码阅读为准，REA 数据用于确定规模与边界。
