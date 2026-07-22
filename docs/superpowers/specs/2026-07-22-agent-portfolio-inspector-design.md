# Agent 作品集运行轨迹与案例页设计

## 背景

Akashic Tarot 已经实现结构化咨询、本地 Qwen2.5-7B、156 条正逆位牌义 RAG、`classify → retrieve → generate → critique` Agent 工作流、逐步 Trace、固定评测集和人工审核闭环。现有产品 Demo 主要展示 3D 交互与最终解读，无法让 Agent 工程岗位的面试官在短时间内确认这些底层能力。

本次改动要把已经存在的工程证据以真实、可复现、不过度包装的方式展示出来。产品中增加 Agent Run Inspector；作品集增加 Agent Engineering Case Study；最后补录约 40 秒技术演示，与现有产品 Demo 组合使用。

## 目标

1. 在咨询结果页中用一次点击展示真实 Agent Trace。
2. 让面试官在 30–45 秒内识别四阶段工作流、RAG、可观测性、质量审查、延迟与人工反馈闭环。
3. 默认不向界面或安全摘要接口暴露完整问题、Prompt、答案预览和原始错误。
4. 提供与 Agent 工程岗位职责直接对应的独立案例页和量化证据。
5. 保持解读主链路不变；Trace 展示失败不能影响解读结果或审核操作。

## 非目标与诚信边界

- 不把当前 workflow Agent 描述为自主任务规划器。
- 不声称已经实现 MCP、Function Calling、多智能体协同或沙箱工具执行。
- 不把 SQLite 历史记录描述为完整的长期记忆系统。
- 不把单机本地 Demo 描述为已经落地的分布式高并发系统。
- 不在本次改动中实现缓存、消息队列、异步 Critic、MCP 或新的记忆策略；这些只进入案例页的演进路线。
- 不修改模型、Prompt、RAG 排序或现有生成行为。

## 交付内容

### 1. Agent Run Inspector

咨询流程进入 `review_ready` 后，右侧栏显示一个折叠的 Agent Run 卡片。用户点击“查看 Agent 轨迹”后才请求安全摘要并展开详情；再次点击可收起。`review_saved` 阶段保留面板，并在本地状态中显示已经保存的人工审核结论。

面板展示：

- 短 Trace ID 和运行完成状态；
- 四个步骤：Intent Router、RAG Retrieve、Generate、Critique；
- 每步成功/失败状态和耗时；
- 总耗时、模型、RAG 命中条数、Critic 分数；
- 分类的 `topic`、`intent`、`tone`；
- RAG 的牌 ID、正逆位、分数和 topic bias；
- 生成长度和截短后的 Prompt Hash；
- Critic 的分数、问题标签和是否需要重试；
- 人工审核的 `accepted`、`needs_work`、`rejected` 或 `edited` 状态。

以下内容不得进入安全摘要响应，也不得进入面板 DOM：

- `input_summary` 中的完整或截断问题；
- `generate.output.preview`；
- 完整 Prompt、RAG 正文和解读正文；
- 原始异常文本与可能包含路径或输入的错误详情。

### 2. Agent Engineering Case Study

新增独立案例页 `docs/portfolio/akashic-agent-case-study.html`，复用项目现有截图、配色和产品视频。页面按招聘方的阅读顺序组织：

1. 项目一句话定位与技术栈；
2. 产品 Demo 和 Agent Trace 演示入口；
3. 结构化咨询到人工审核的完整数据流；
4. RAG 与可控生成；
5. Trace、评测与人工反馈闭环；
6. 真实量化指标；
7. 已实现能力与下一阶段工程化的明确边界。

案例页采用当前评测结果中的真实指标：

- 156 条正逆位领域语料；
- 30 题固定评测集；
- 90% 意图分类准确率；
- 8.17/10 平均 Critic 分数；
- 26.8 秒平均总延迟。

案例页包含现有产品视频。新的 `docs/demo/akashic-agent-trace.mp4` 存在时显示第二段视频；文件尚未加入仓库时，媒体错误处理会隐藏空视频并显示指向 `../../Three.html?control=mouse` 的“打开本地 Agent Demo”入口，不产生破损媒体组件。README 增加指向案例页的入口，但不重写现有功能文档。

### 3. 补录脚本

补录目标长度约 40 秒：

| 时间 | 画面 | 讲述重点 |
|---|---|---|
| 00–05 秒 | 承接解读结果 | 用户看到最终答案，系统同时保留完整执行轨迹。 |
| 05–12 秒 | 点击“查看 Agent 轨迹” | 展示 Classify、Retrieve、Generate、Critique 四阶段。 |
| 12–23 秒 | 停留在真实指标 | 本地 Qwen2.5-7B、RAG 命中、总耗时和分阶段延迟。 |
| 23–31 秒 | 展开 Critic 与隐私信息 | 8/10、问题标签、无需重试；Prompt 仅显示 Hash。 |
| 31–37 秒 | 保存人工审核 | Accepted 状态写入，形成可评估的数据闭环。 |
| 37–42 秒 | 切到案例页 | 30 题评测、90% 准确率和工程演进路线。 |

## 架构与组件边界

### 安全 Trace 摘要 API

复用现有路由：

```text
GET /api/interpret/{reading_id}/agent-trace?view=summary
```

不带 `view=summary` 时保留现有内部调试响应，避免破坏已有测试和调试工具。摘要模式由后端完成白名单投影，不能依赖前端隐藏敏感字段。

摘要响应结构（以下只节选第一个步骤；正式响应包含本次运行的全部已记录步骤）：

```json
{
  "reading_id": 15,
  "trace_id": "725886e681f44cfeb5644d87d9c9cd46",
  "status": "complete",
  "metrics": {
    "total_duration_ms": 56481,
    "model": "ollama:qwen2.5:7b",
    "rag_hits": 6,
    "critique_score": 8
  },
  "steps": [
    {
      "step_index": 0,
      "step": "classify",
      "ok": true,
      "duration_ms": 27952,
      "model": "qwen2.5:7b",
      "output": {
        "topic": "growth",
        "intent": "clarity",
        "tone": "neutral"
      }
    }
  ]
}
```

摘要投影按步骤白名单输出：

- `classify`：`topic`、`intent`、`tone`；
- `retrieve`：`count`、`entries[].card_id`、`orientation`、`score`、`topic_bias`；
- `generate`：`length`、`prompt_hash`；
- `critique`：`score`、`issues`、`needs_retry`。

未知步骤仅返回公共元数据和空 `output`。失败步骤返回 `ok: false` 和 `has_error: true`，不返回原始 `error`。空 Trace 返回 `status: "unavailable"`、空步骤与空指标，而不是把它当成 HTTP 错误。

### 前端 API 与纯数据映射

`js/api.js` 增加 `loadAgentRunSummary(readingId)`，固定请求 `view=summary`、使用 `cache: "no-store"`，并把非 2xx 响应转换为稳定错误。

新增独立的 `js/agent_trace.js`，职责限制为：

- 校验并规范化摘要响应；
- 按固定步骤顺序生成展示模型；
- 计算缺失状态和安全文案；
- 渲染折叠/展开面板；
- 接收人工审核状态并更新反馈徽标。

该模块不发起生成、不读取数据库、不访问完整问题或答案，也不持有咨询状态机。

### 咨询流程集成

`Three.html` 的咨询右栏改为一个侧栏容器，内部保留现有 `consultation-flow-status`，并增加独立的 `consultation-agent-inspector` 挂载点。这样 `setStatus` 的错误/成功提示不与 Inspector 争用同一个 DOM 节点。

`js/consultation_flow.js` 只负责生命周期集成：

- `review_ready`：根据 `saved.readingId` 和解读的 Trace 信息挂载折叠卡片；
- 用户点击后调用 `loadAgentRunSummary`；同一 reading 在一次弹窗生命周期内只请求一次；
- `review_saved`：保留已经加载的摘要并传入人工审核结论；
- `reset`、`close` 或新咨询：清除 Inspector 本地状态；
- 其他阶段隐藏 Inspector。

Trace 请求是结果完成后的按需读取，不进入生成关键路径，不改变 SSE、Critic 或审核保存时序。

### 布局与可访问性

- 桌面端沿用现有三栏结构：步骤、主内容、状态/Inspector 侧栏。
- 窄屏沿用现有响应式断点，把侧栏堆叠到解读正文之后。
- 展开按钮使用真实 `button` 和 `aria-expanded`；详情区域使用稳定 ID 与 `aria-controls`。
- 加载状态使用 `role="status"`；错误信息不自动抢焦点。
- 步骤状态不能只靠颜色区分，同时显示图标与文字。
- 继续复用现有主题 Token，并支持明暗主题与 `prefers-reduced-motion`。

## 状态与异常处理

| 情况 | 界面行为 |
|---|---|
| Trace 正常 | 展示汇总与四阶段详情。 |
| 用户尚未展开 | 不请求 API，仅显示入口。 |
| 无问题的快速路径 | 显示“本次运行未启用 Agent Trace”。 |
| 摘要为空 | 显示不可用状态，不影响解读和审核。 |
| 请求失败 | 显示“轨迹暂不可用，可稍后重试”；允许再次点击重试。 |
| 单步骤失败 | 该步骤显示失败与 `has_error`，其他步骤正常展示。 |
| 未知或缺失步骤 | 按已知顺序展示，缺失项标为未记录，不抛异常。 |
| 审核保存成功 | 本地反馈徽标更新为实际结论。 |
| 审核保存失败 | Inspector 不伪造反馈状态，沿用现有审核错误提示。 |

## 测试策略

### Python

- 摘要接口正常返回并计算总耗时、模型、RAG 数量和 Critic 分数；
- 四种步骤只输出白名单字段；
- `input_summary`、生成预览和原始错误不会出现在序列化响应中；
- 空 Trace、失败步骤、未知步骤和乱序步骤稳定返回；
- 不带 `view=summary` 的旧响应保持兼容；
- 删除 reading 后 Trace 行为保持现有约束。

### JavaScript

- API 客户端固定请求安全摘要且禁用缓存；
- 展示模型按四阶段排序并正确处理缺失数据；
- 折叠、加载、成功、空数据、失败和重试状态；
- 敏感字段即使出现在恶意/异常响应中也不会进入 DOM；
- `review_ready` 才挂载，`review_saved` 更新反馈，`reset` 清理状态；
- 桌面端与响应式 CSS 合约、`aria-expanded` 和状态语义。

### 完整验证

- 运行全部 Python 单元测试；
- 运行全部 JavaScript 测试与语法检查；
- 在真实 reading #15 上核对四阶段、56.481 秒、6 条 RAG 和 8/10 Critic；
- 在 2560×1440 下确认 Inspector 不遮挡解读正文；
- 在窄屏下确认侧栏堆叠；
- 确认 8080 保持关闭，演示服务继续使用 8082。

## 完成标准

1. 面试官能从同一结果画面识别四阶段 Agent 工作流和真实运行指标。
2. 安全摘要由后端白名单生成，敏感字段不进入响应。
3. Inspector 的任何失败都不影响解读、审核和弹窗关闭。
4. 案例页准确引用现有实现与真实评测数据，并明确未实现能力。
5. 全量测试通过，真实 reading #15 与界面指标一致。
6. 补录脚本可在 30–45 秒内完整走完。
