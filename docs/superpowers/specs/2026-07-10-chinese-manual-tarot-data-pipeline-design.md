# 中文手动录牌与训练数据闭环设计

日期：2026-07-10

状态：待用户审核

范围：中文咨询、手动录牌、人工审核、功能型咨询模块、SFT 数据导出

## 1. 背景与目标

Akashic Tarot 已有 3D 抽牌、本地 Qwen2.5-7B 解读、156 条正逆位牌义 RAG、`classify → retrieve → generate → critique` Agent 流程和 30 题固定评测集。当前缺口不在生成能力，而在可复用的数据闭环：真实运行库没有保存完整的“问题—牌阵—回答—人工评价”，`interpretations` 也没有保存生成时的用户问题快照。

本设计的目标是完成一条可实际使用、也能自然积累中文训练数据的纵向链路：

```text
线下抽实体牌
  → 网页手动录入牌名、正逆位和位置
  → 输入问题与可选背景
  → 复用现有 RAG + Agent 生成中文解读
  → 用户接受、拒绝或编辑答案
  → 仅导出人工确认的中文 SFT 样本
```

在这条链路稳定后，通过同一个模块框架增加“二选一”和“象征性传讯”等特定咨询玩法。

## 2. 设计原则

1. **RAG 管知识，LoRA 管行为。** 牌义继续由现有 156 条语料提供；微调重点是中文表达、咨询结构、安全边界和可行动性。
2. **运行数据不等于训练数据。** 模型生成的回答默认只是候选样本，必须经人工接受或编辑后才可导出。
3. **不训练显式思维链。** 分类、检索、裁判和内部标注用于筛选与分析；默认 SFT target 只包含最终回复。
4. **完整溯源。** 每个样本能追溯到咨询、抽牌、模型、Prompt 版本、RAG 语料版本、Agent trace 和人工审核。
5. **模块共享基础设施。** 普通咨询、二选一与象征性传讯共享同一个 Agent；模块只定义字段、牌位、Prompt overlay、输出约束和安全规则。
6. **隐私默认收紧。** 数据只保存在本地；导出前进行敏感信息检测与人工确认。

## 3. 范围与非目标

### 3.1 本轮范围

- 中文手动录牌咨询工作台。
- 保存问题、背景、牌阵、卡牌、正逆位和输入方式。
- 保存每次生成的完整输入快照和生成溯源。
- 对回答执行“接受 / 需要改进 / 拒绝 / 编辑为理想答案”。
- 中文 Canonical Dataset 母表和 ChatML/`messages` JSONL 导出。
- `general_reading`、`choice_compare`、`symbolic_message` 三类模块契约。
- 将安全性加入本地 critic、离线 judge 与导出过滤。

### 3.2 非目标

- 第一阶段不执行 QLoRA 训练；先证明能持续生产合格数据。
- 不增加账号、云同步、多人标注或公共数据上传。
- 不做多轮长期记忆。
- 不让模型声称能读取第三方真实想法、预测确定未来或替代医疗、法律、财务建议。
- 不自动把所有历史回答加入训练集。
- 第一阶段不训练英文数据，但所有核心记录保留 `language` 字段以便以后扩展。

## 4. 交付顺序

### 阶段 0：数据契约与迁移

先定义咨询、生成版本、人工审核和导出样本之间的关系；对 SQLite 做幂等迁移。补齐当前 `interpretations` 无法还原原始问题的缺口。

### 阶段 1：手动录牌纵向闭环

完成一个可独立于 3D 动画使用的“咨询工作台”：输入问题、选择牌阵、搜索并录入实体牌、设置正逆位、确认牌阵、调用现有 Agent、查看流式结果并审核。

### 阶段 2：数据审核与中文导出

提供回答版本历史、审核状态和编辑后的最终答案。导出器只读取满足资格条件的样本，生成版本化 Canonical JSONL 和 SFT JSONL。

### 阶段 3：功能型咨询模块

实现模块注册表，加入二选一与象征性传讯。它们复用同一数据表、Agent、审核流程和导出器。

### 阶段 4：质量评测与训练准备

扩展生产 HTTP 路径评测，建立基座模型基线、模块覆盖率和安全指标。在样本量与质量达标后，另行设计 QLoRA 训练计划。

## 5. 用户体验设计

### 5.1 入口

在现有应用中增加“手动解读”入口，打开独立的全屏工作台面板。它复用现有主题、卡牌图像、牌名数据和解读组件，但不强行经过 3D 洗牌与抽牌动画。

保留现有 3D 流程不变。3D 抽牌与手动录牌最终都创建同一种 `reading`，区别由 `input_mode` 标记。

### 5.2 手动录牌流程

1. 选择咨询模块，默认“普通咨询”。
2. 输入中文问题；手动工作台中问题必填，长度 4–500 字。
3. 可选输入背景，长度 0–1000 字；界面提示避免输入真实姓名、电话、地址等敏感信息。
4. 选择已有牌阵模板，或选择自由牌阵；第一版自由牌阵支持 1–10 张牌。
5. 每个牌位通过中文名、英文名或编号搜索 78 张牌。
6. 设置正位或逆位；状态必须明确，不使用空值表示正位。
7. 可调整顺序、替换或删除卡牌。实体牌组内禁止重复选择同一张牌。
8. 提交前显示问题、背景、牌阵和全部牌位的确认页。
9. 保存咨询后调用现有 SSE 解读接口，展示流式回答。
10. 用户对回答执行接受、需要改进、拒绝或编辑确认。

### 5.3 回答审核

每个生成版本提供以下操作：

- **接受**：保留模型原回答，进入“可导出候选”。
- **需要改进**：保存 1–5 个问题标签和可选备注，不可导出。
- **拒绝**：保存拒绝原因，不可导出，可作为未来偏好数据的 rejected。
- **编辑为理想答案**：保留原回答，并另存用户修改后的最终答案；修改版优先作为 SFT target。

建议的问题标签为：`不回应问题`、`牌义错误`、`机械罗列`、`空泛套话`、`过度宿命`、`擅测他人想法`、`建议不可执行`、`语气不合适`、`事实或安全风险`、`其他`。

## 6. 数据模型

### 6.1 现有表保留

- `readings`：一次牌阵或每日一牌的身份记录。
- `reading_cards`：该次牌阵的卡牌与牌位。
- `interpretations`：一次生成版本。
- `agent_steps`：Agent trace。
- `corpus_embeddings`：RAG 嵌入缓存。

### 6.2 新表 `consultations`

与 `readings` 一对一，保存用户输入和模块语义。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 咨询 ID |
| `public_id` | TEXT UNIQUE | 创建时生成的不可变 UUID，用于稳定导出与切分 |
| `reading_id` | INTEGER UNIQUE FK | 对应牌阵 |
| `schema_version` | TEXT | 初始为 `1.0` |
| `language` | TEXT | 第一版固定 `zh` |
| `module_type` | TEXT | `general_reading` / `choice_compare` / `symbolic_message` |
| `input_mode` | TEXT | `manual` / `three_d` / `eval` / `synthetic` |
| `user_query` | TEXT | 用户问题原文 |
| `user_context` | TEXT NULL | 可选背景 |
| `module_payload_json` | TEXT | 模块特有输入 |
| `privacy_status` | TEXT | `unchecked` / `clear` / `redacted` / `blocked` |
| `created_at` | TEXT | UTC ISO-8601 |
| `updated_at` | TEXT | UTC ISO-8601 |

`module_payload_json` 只保存模块特有字段，不重复保存通用字段。

### 6.3 扩展 `interpretations`

在现有字段上增加：

| 字段 | 类型 | 说明 |
|---|---|---|
| `public_id` | TEXT UNIQUE | 生成时创建的不可变 UUID |
| `input_snapshot_json` | TEXT | 生成时的咨询、牌阵和卡牌快照 |
| `rag_snapshot_json` | TEXT | 实际注入的 RAG 条目与语料签名 |
| `trace_id` | TEXT NULL | 对应 Agent trace |
| `prompt_version` | TEXT | 例如 `manual-general-v1` |
| `generation_status` | TEXT | `complete` / `partial` / `failed` |
| `safety_flags_json` | TEXT | 运行时安全检查结果 |

快照用于防止用户后来修改咨询或语料后无法复现实验。`partial` 和 `failed` 永远不能导出。

### 6.4 新表 `interpretation_reviews`

每个 interpretation 最多一个当前人工审核记录，更新时保留 `updated_at`；原始模型回答永不覆盖。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 审核 ID |
| `interpretation_id` | INTEGER UNIQUE FK | 生成版本 |
| `verdict` | TEXT | `accepted` / `needs_work` / `rejected` / `edited` |
| `rating` | INTEGER NULL | 1–5，可选 |
| `issue_tags_json` | TEXT | 问题标签数组 |
| `review_note` | TEXT NULL | 人工备注 |
| `edited_content` | TEXT NULL | 理想答案；仅 `edited` 必填 |
| `privacy_confirmed` | INTEGER | 是否确认可进入本地训练集 |
| `reviewed_at` | TEXT | UTC ISO-8601 |
| `updated_at` | TEXT | UTC ISO-8601 |

### 6.5 不建立可变的 `dataset_samples` 运行表

训练数据由只读导出器根据咨询、生成和审核表生成。这样可避免数据库样本与 JSONL 文件产生双重事实来源。每次导出写 manifest，记录导出条件、样本 ID 哈希、数量和版本。

### 6.6 迁移兼容性

迁移必须幂等并兼容已有本地数据库：

- 新表通过 `CREATE TABLE IF NOT EXISTS` 创建。
- `interpretations` 的新增字段通过列检查逐项添加；已有行生成并回填唯一 `public_id`。
- 旧 interpretation 缺少完整输入快照，统一标记为不可导出，不根据 `prompt_hash` 猜测用户问题。
- 新字段和索引全部创建成功后才提交迁移事务；失败时保留旧库可用。
- 迁移测试必须覆盖只有 `readings` / `reading_cards` 的旧数据库，以及已经包含 Phase 1/2 AI 表的数据库。

## 7. Canonical Dataset Schema

Canonical JSONL 是训练前的唯一交换格式。它保留丰富元数据，但不直接作为 SFT 输入。

```json
{
  "schema_version": "1.0",
  "sample_id": "ak_01J2Q7A4K9M6P3R8T5V0W1X2YZ",
  "language": "zh",
  "module_type": "general_reading",
  "source": {
    "input_mode": "manual",
    "consultation_id": 12,
    "reading_id": 18,
    "interpretation_id": 31,
    "origin": "human_use"
  },
  "input": {
    "user_query": "我是否应该接受这个工作机会？",
    "user_context": "目前有一份稳定工作，但成长空间有限。",
    "spread": {
      "template_key": "three_timeline",
      "template_name": "三张牌时间线"
    },
    "cards": [
      {
        "slot": 1,
        "slot_key": "past",
        "slot_label": "过去",
        "card_id": 9,
        "zh": "隐者",
        "en": "The Hermit",
        "orientation": "upright"
      }
    ],
    "module_payload": {}
  },
  "target": {
    "answer": "这组三张牌更适合被理解为一次对成长空间与安全感的权衡。隐者提示你先确认自己真正欠缺的是资源、方向还是自主性，再判断新机会能否回应这个核心需求。",
    "answer_source": "human_edited"
  },
  "labels": {
    "topic": "career",
    "intent": "decision",
    "tone": "anxious",
    "style": "psychological",
    "safety_flags": []
  },
  "quality": {
    "rule_passed": true,
    "critic_score": 8,
    "judge_scores": {},
    "human_verdict": "edited",
    "human_rating": 5,
    "issue_tags": []
  },
  "provenance": {
    "generator_model": "ollama:qwen2.5:7b",
    "prompt_version": "manual-general-v1",
    "prompt_hash": "9fd4f21c1d6e7a02",
    "corpus_signature": "c81e390a45d312bf",
    "trace_id": "5c50e8e54d9f4e47b16504a6829ed137",
    "generated_at": "2026-07-10T12:00:00Z",
    "reviewed_at": "2026-07-10T12:05:00Z"
  }
}
```

`labels` 是辅助监督与切分元数据，不作为默认回复目标。缺失的自动分类字段可为 `null`，但不能伪造。

## 8. SFT 导出 Schema

导出器从 Canonical 记录生成 Qwen/LLaMA-Factory 可消费的 `messages` JSONL：

```json
{
  "id": "ak_01J2Q7A4K9M6P3R8T5V0W1X2YZ",
  "messages": [
    {
      "role": "system",
      "content": "你是一位以塔罗象征辅助自我反思的中文咨询助手。回应应克制、具体、非宿命，并将建议落到用户可控制的行动。"
    },
    {
      "role": "user",
      "content": "问题：我是否应该接受这个工作机会？\n背景：目前有一份稳定工作，但成长空间有限。\n牌阵：三张牌时间线\n过去：隐者（正位）\n现在：命运之轮（正位）\n未来：力量（正位）"
    },
    {
      "role": "assistant",
      "content": "人工接受或编辑确认后的最终答案"
    }
  ],
  "metadata": {
    "module_type": "general_reading",
    "topic": "career",
    "style": "psychological",
    "split": "train"
  }
}
```

导出资格必须同时满足：

- `language == "zh"`。
- `generation_status == "complete"`。
- 人工结论为 `accepted` 或 `edited`。
- `privacy_confirmed == 1` 且 `privacy_status` 不是 `blocked`。
- 没有阻断级安全标志。
- 问题、卡牌和最终回答完整。
- 最终回答通过长度、格式、重复和套话规则检查。

`sample_id` 由 interpretation 的 `public_id` 与最终 target 内容哈希确定；编辑 target 后会形成新的样本版本。训练/验证/测试切分按 consultation 的 `public_id` 稳定哈希完成，默认 80/10/10，因此同一咨询的所有生成和编辑版本必定落在同一 split，防止泄漏。

## 9. 咨询模块框架

### 9.1 模块注册表

每个模块配置：

```text
module_type
display_name
input_schema
spread_template
validation_rules
prompt_overlay
output_contract
safety_rules
eval_rubric
```

模块注册表是唯一分派点。后端根据 `module_type` 验证输入、选择牌位和 Prompt overlay，再进入同一个检索与生成管线。

### 9.2 普通咨询 `general_reading`

- 输入：`user_query`、可选 `user_context`。
- 牌阵：任意已有模板或自由牌阵。
- 输出：直接回应问题，综合牌位关系，给出非宿命、可行动的反思。

### 9.3 二选一 `choice_compare`

- 模块字段：`option_a`、`option_b`、可选 `decision_priorities`。
- 固定六牌位：当前核心需求、A 的潜力、A 的代价、B 的潜力、B 的代价、选择原则。
- 输出顺序：共同前提 → A 的机会与代价 → B 的机会与代价 → 决策原则。
- 禁止仅凭单张牌宣判 A 或 B；禁止使用“命中注定”“一定选某项”。

### 9.4 象征性传讯 `symbolic_message`

- 产品名称可显示为“即时传讯”，内部类型保持 `symbolic_message`。
- 模块字段：`relationship_context`、可选 `focus`。
- 固定三牌位：关系中的情绪氛围、尚未说出的主题、用户可采取的边界或行动。
- 页面和回答开头明确：这是基于牌面的象征性反思，不代表读取对方真实思想。
- 禁止替第三方生成带引号的“真实原话”；禁止断言对方正在欺骗、出轨、监视或一定会联系用户。

## 10. Prompt 与 Agent 变化

现有基础 Prompt、风格 overlay 和 RAG 均保留。新增顺序为：

```text
基础角色与格式约束
  + 模块 overlay
  + 风格 overlay
  + RAG 牌义资料
  + 结构化咨询输入
  + 模块输出契约
```

分类结果继续作为标签和检索辅助，不在用户回复中显式展示。Critic 扩展以下问题：

- `fatalism`：确定性命运或时间断言。
- `mind_reading`：声称知道第三方真实想法。
- `fear_escalation`：制造背叛、诅咒、伤害等恐惧。
- `high_stakes_overreach`：替代医疗、法律或财务专业判断。
- `dependency_language`：诱导用户持续依赖占卜。
- `off_topic`、`missing_card`、`slop_phrase`、`too_listy`、`platitude` 等现有问题。

Critic 只提供过滤信号，不能自动把样本升级为可训练状态。

## 11. API 边界

### 11.1 咨询与录牌

- `POST /api/consultations`：在一个事务中创建 reading、cards 和 consultation。
- `GET /api/consultations/<id>`：返回完整咨询及生成历史。
- `GET /api/consultations?limit=&module_type=`：供后台审核列表使用。

`POST /api/consultations` 必须校验字段长度、模块类型、牌阵槽位、卡牌唯一性、正逆位和模块 payload。

### 11.2 解读

保留 `POST /api/interpret/<reading_id>` 的 SSE 形式。手动工作台必须从已保存的 consultation 读取问题和模块数据，不再依赖浏览器临时传入的问题作为唯一事实来源。为兼容现有 3D 流程，如果 reading 尚无 consultation，接口继续接受现有请求体中的可选 `question`，并在生成前原子创建 `input_mode=three_d` 的 consultation；没有问题的旧式快速解读仍可运行，但不具备 SFT 导出资格。允许请求覆盖风格，但必须将最终输入写入 `input_snapshot_json`。

### 11.3 审核与导出

- `PUT /api/interpretations/<id>/review`：创建或更新人工审核。
- `POST /api/datasets/export`：生成本地导出文件和 manifest；默认只允许后台页面调用。
- `GET /api/datasets/summary`：返回合格、待审、拒绝和各模块样本数，不返回敏感正文。

## 12. 错误处理与一致性

- 创建咨询失败时整个事务回滚，不留下孤立 reading。
- 模块 payload 不合法返回结构化 400，字段错误逐项列出。
- 牌位不足、重复牌或缺少正逆位时禁止提交。
- SSE 中断时保留 `partial` 生成版本用于调试，但不可导出。
- RAG 不可用时允许降级生成，同时在快照中记录 `rag_status=degraded`。
- Agent 分类或 critic 失败不阻断用户得到回答，但相应质量字段标为缺失，不能伪装成通过。
- 重试生成新增 interpretation 版本，不覆盖旧版本与审核记录。
- 删除 reading 时级联删除 consultation、interpretations、reviews 和 agent steps；导出的历史文件不自动删除，界面需明确提示。
- 数据导出采用临时文件完成后原子重命名，避免中断产生半个 JSONL。

## 13. 测试策略

### 13.1 单元测试

- 前端：卡牌搜索、选择、正逆位、去重、排序、自由牌阵状态和模块表单。
- 后端：咨询字段验证、模块 payload、数据库迁移、事务回滚、输入快照、审核状态机和导出资格。
- 导出：Canonical/SFT 格式、稳定 split、同咨询防泄漏、隐私阻断、编辑答案优先。
- Prompt：每个模块的 overlay、安全约束、全部牌位和问题均进入消息。

### 13.2 集成测试

- 从 `POST /api/consultations` 到 SSE 解读、审核和导出的完整本地流程。
- 使用 mock 模型与 mock embedder，CI 不依赖外部网络。
- 修复现有评测绕过生产 HTTP 层的问题，确保 reading → cards transform、锁和设置解析均被覆盖。

### 13.3 评测集

- 保留现有 30 题作为普通咨询基线。
- 新增至少 12 道二选一和 12 道象征性传讯固定题。
- 安全反例至少覆盖宿命论、第三方读心、健康越界、恐惧升级和依赖诱导。
- 报告同时呈现主题准确率、牌面落地、问题相关性、具体性、安全通过率和人工接受率。

## 14. 验收标准

### 14.1 手动录牌闭环

- 用户可在不进入 3D 抽牌流程的情况下完成问题、背景和 1–10 张实体牌录入。
- 刷新页面后可从历史记录恢复咨询、卡牌、正逆位与所有回答版本。
- Agent 使用保存的问题与模块信息生成回答。
- 用户可接受、拒绝、标记问题或编辑答案。

### 14.2 数据闭环

- 一个被接受的回答可导出为一条 Canonical 和一条 SFT 记录。
- 一个被编辑的回答使用编辑文本作为 target，同时保留原始模型文本用于溯源。
- 未审核、需要改进、拒绝、partial、隐私未确认或安全阻断的回答不会进入 SFT。
- 同样的数据库状态与导出版本产生同样的 sample ID；同一 consultation 的所有回答版本产生同样的 split。

### 14.3 功能模块

- 二选一同时讨论两项的潜力与代价，并输出决策原则。
- 象征性传讯始终标明反思属性，不声称读取第三方真实思想。
- 新模块不复制模型调用、RAG、审核或导出实现。

## 15. 实施边界与后续决策

实施计划应先交付阶段 0–2 的纵向闭环，再开始阶段 3。阶段 4 的 QLoRA 启动条件不是固定条数，而是同时满足：

- 至少 200 条人工接受或编辑的中文样本。
- 核心主题与模块不存在明显单一分布。
- 独立测试集与训练集按咨询隔离。
- 安全反例通过率达到设计时确定的阈值。
- 基座 + RAG 的基线报告已冻结，可与微调模型做盲评比较。

在这些条件之前，继续改进数据生产与审核流程比提前训练更有价值。
