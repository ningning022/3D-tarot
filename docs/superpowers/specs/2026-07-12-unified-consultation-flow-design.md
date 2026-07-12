# 统一新咨询流程设计

日期：2026-07-12

状态：已批准修订

范围：统一咨询入口、无问题/普通咨询、网站抽牌/手动录牌、可选 AI 解读与人工审核

## 1. 目标

Akashic Tarot 现有产品流程以“如何抽牌”为主轴：用户先完成 3D 抽牌，之后才可能输入问题并请求 AI 解读。这个顺序不利于表达咨询意图，也会把手动录牌误建成一套与 3D 抽牌平行的独立产品。

本设计把一级概念改为“新咨询”，并把三个互相独立的维度拆开：

```text
咨询类型：无特定问题 / 普通咨询 / 二选一 / 即时传讯
牌面来源：网站 3D 抽牌 / 手动录入实体牌
解读动作：立即 AI 解读 / 稍后解读 / 仅保存
```

第一阶段只启用“无特定问题”和“普通咨询”，但主流程、状态模型和模块注册表必须允许二选一与即时传讯在后续直接注册，不再重写入口、抽牌、保存、解读或审核流程。

## 2. 核心原则

1. **咨询意图先于牌面。** 有问题时先填写问题，再选择牌阵与牌面来源。
2. **模块与输入方式正交。** 普通咨询、二选一和即时传讯都可以使用网站抽牌或手动录牌。
3. **AI 解读不是保存前提。** 用户可以立即解读、稍后解读或只保留牌阵。
4. **无问题不伪造问题。** 无特定问题的牌阵只创建 reading，不写入虚假的 consultation，也不具备 SFT 导出资格。
5. **模块拥有牌阵语义。** 第一版不开放自定义牌位编辑器；专属模块使用专属牌阵，确保每张牌在 Prompt 中有明确职责。
6. **一条保存路径。** 网站抽牌和手动录牌最终都产生相同的 reading/cards；有问题时再同时产生 consultation。
7. **运行记录不自动成为训练数据。** 只有完整生成且经人工接受或编辑、隐私确认和安全过滤的版本才是后续导出候选。

## 3. 信息架构

采用集成式“新咨询”全屏向导，复用 `Three.html` 的主题、牌库、牌阵和解读基础设施。

没有采用以下方案：

- 在现有 3D 流程末尾追加问题抽屉：问题出现过晚，手动录牌仍需另一套入口。
- 为每个模块建立独立页面：会重复牌阵选择、牌面获取、保存、解读、审核和错误恢复。
- 把创建流程放进后台：后台的职责是历史查看、设置和审核，不应成为主要咨询入口。

现有顶栏“新占卜 / New”在空闲状态下改为打开统一向导。向导关闭后保持原 3D 舞台、主题和牌库浏览状态。

## 4. 用户流程

### 4.1 第一步：咨询类型

第一阶段显示两个可用选项：

- **无特定问题**：直接体验牌阵，不要求问题。
- **普通咨询**：填写一个明确的中文问题。

二选一和即时传讯在第一阶段不显示禁用占位，避免用户看到不可用入口。它们在对应模块完成后由注册表自动加入。

### 4.2 第二步：咨询信息

无特定问题：

- 不显示问题输入框。
- 可显示简短说明：该记录可做通用牌面反思，但不会进入问题—回答训练集。

普通咨询：

- 中文问题必填，去除首尾空白后长度为 4–500 字。
- 背景可选，长度不超过 1000 字。
- 提示避免填写真实姓名、电话、地址、身份证号等敏感信息。

解读风格属于生成配置而非咨询语义，默认 `psychological`，可选 `traditional`、`intuitive` 和 `psychological`。语言第一阶段固定为中文。

### 4.3 第三步：牌阵与牌面来源

无特定问题和普通咨询都允许：

- 三张牌时间线 `three_timeline`。
- 五张牌十字 `five_cross`。
- 凯尔特十字 `celtic_cross`。
- 自由牌阵 `free`，1–10 张，默认 3 张。

牌面来源：

- **网站抽牌 `three_d`**：关闭向导进入现有 3D 舞台，按选定牌阵完成抽牌。
- **手动录入 `manual`**：留在向导内，用牌库搜索器录入实体牌。

### 4.4 第四步：解读动作

在开始获取牌面前选择：

- **立即 AI 解读 `now`**：保存成功后自动启动 SSE。
- **稍后解读 `later`**：保存后进入完成页，可从历史记录启动解读。
- **仅保存 `none`**：保存后结束，不自动打开模型面板。

`interpretation_action` 只影响当前界面行为，不写入数据库，也不改变训练资格。

### 4.5 获取与确认牌面

网站抽牌：

1. 向导保存内存中的 consultation draft。
2. 设置活动牌阵并进入现有 3D 抽牌状态。
3. 左侧状态区显示当前咨询摘要和牌阵，避免用户忘记当前意图。
4. 完成牌阵后显示确认页，再进行服务器保存。

手动录牌：

1. 固定牌阵自动创建对应牌位；自由牌阵先选择 1–10 张。
2. 每个牌位支持中文名、英文名和从 0 开始的牌编号搜索。
3. 选择后显示图片、中文/英文名、编号和明确的正/逆位开关。
4. 同一 reading 禁止重复 `cardId`。
5. 固定牌阵不提供拖拽排序；牌位本身定义顺序。

统一确认页显示：咨询类型、问题、背景、牌阵、全部牌位、卡牌、正逆位、牌面来源和解读动作。正逆位同时通过文字和图片方向表达。

## 5. 保存与解读逻辑

### 5.1 有问题的咨询

网站抽牌或手动录牌完成后统一调用：

```text
POST /api/consultations
```

服务端在一个事务中写入 reading、cards 和 consultation。`inputMode` 分别为 `three_d` 或 `manual`。

### 5.2 无特定问题

统一调用：

```text
POST /api/readings
```

不创建 consultation，不把“随便看看”“无问题”等占位文字写入 `user_query`。如果用户选择立即 AI 解读，使用现有无问题快速路径生成通用牌面反思；该 interpretation 没有已确认问题，因此不具备 SFT 导出资格。

### 5.3 解读动作

保存返回 `readingId` 后：

- `now`：调用 `POST /api/interpret/<readingId>` SSE；有 consultation 时不再次传 `question`。
- `later`：显示“已保存，可从最近记录或后台解读”。
- `none`：显示保存成功，不主动加载模型健康状态。

生成失败时保留已保存的 reading/consultation，只重试 SSE，不重复创建数据库记录。重新生成新增 interpretation，不覆盖旧版本。

### 5.4 人工审核

完整 SSE 收到 `done=true` 后，重新读取咨询或 interpretation 历史，以服务端最新 interpretation ID 作为审核对象。无问题解读可以保留和查看，但不显示“训练候选”隐私确认。

有问题的普通咨询支持：

- `accepted`：接受原回答。
- `needs_work`：选择问题标签并可写备注。
- `rejected`：保存拒绝结论和原因。
- `edited`：填写理想答案，原模型文本不覆盖。

评分为可选 1–5。`accepted` 和 `edited` 显示隐私确认；未确认仍可保存审核，但不具备导出资格。

## 6. 模块与牌阵注册表

### 6.1 模块注册表

后端建立权威模块注册表，公开安全的 UI 描述供前端读取。每个模块定义：

```text
module_type
display_name
description
question_required
input_fields
allowed_spreads
default_spread
prompt_version
prompt_overlay
output_contract
safety_rules
enabled
```

第一阶段注册并启用 `general_reading`。无特定问题是 UI/保存分支，不是伪造的 module type。

新增接口：

```text
GET /api/consultation-modules
```

只返回 `enabled=true` 的公共字段，不向前端暴露内部 Prompt 全文或评测规则。服务端仍独立验证 module、字段和允许牌阵，不能信任前端注册表。

### 6.2 第一阶段模块

`general_reading`：

- 字段：`user_query`、可选 `user_context`。
- 允许牌阵：三张、五张、凯尔特十字、自由牌阵。
- 输出：回应问题、综合牌位关系、给出非宿命且可行动的反思。

### 6.3 后续二选一

`choice_compare`：

- 字段：`option_a`、`option_b`、可选 `decision_priorities`。
- 专属牌阵 `choice_six`：当前核心需求、A 的潜力、A 的代价、B 的潜力、B 的代价、选择原则。
- 网站抽牌和手动录牌都严格使用这六个牌位。
- 输出顺序：共同前提 → A 的机会与代价 → B 的机会与代价 → 决策原则。
- 禁止用单张牌宣判选择，禁止“命中注定”或确定性结果。

### 6.4 后续即时传讯

`symbolic_message`：

- 展示名称为“即时传讯”，内部类型保持 `symbolic_message`。
- 字段：`relationship_context`、可选 `focus`。
- 专属牌阵 `symbolic_message_three`：关系中的情绪氛围、尚未表达的主题、用户可采取的边界或行动。
- 网站抽牌和手动录牌都严格使用这三个牌位。
- 回答必须声明这是牌面象征性反思，不代表读取第三方真实思想。
- 禁止编造对方原话，禁止断言欺骗、出轨、监视或必然联系。

第一版不允许用户自由编辑专属模块的牌位名称或数量。未来如增加自定义牌阵，需要单独设计牌位语义编辑器与 Prompt 校验。

## 7. 前端架构

### 7.1 新文件

- `js/consultation_flow.js`：注册表状态、统一向导、草稿状态机、手动录牌、3D 交接、保存、解读和审核编排。
- `css/consultation_flow.css`：全屏向导、模块选择、牌面来源、手动录牌、确认、结果和响应式样式。
- `tests/test_consultation_flow.js`：纯状态、搜索、校验、Payload、保存分派和失败恢复测试。

### 7.2 修改文件

- `Three.html`：增加统一向导容器、当前咨询摘要、样式和脚本引用。
- `js/main.js`：空闲状态的“新占卜”打开向导；暴露开始 3D 咨询和完成后的保存交接点。
- `js/spread.js` / `js/spread_flow.js`：完成牌阵后把 cards 交给 consultation flow，而不是直接决定保存方式。
- `js/api.js`：增加模块列表、创建咨询、读取咨询和保存审核方法；错误对象保留服务端 message。
- `js/spread_templates.js`：让模块指定允许牌阵；后续模块只需注册专属模板。
- `css/responsive.css`：处理 820px 以下单栏与约 390px 窄屏。
- `README.md`：更新统一入口与三种解读动作。

### 7.3 纯逻辑边界

`consultation_flow.js` 使用 IIFE，同时支持浏览器全局与 `module.exports`。至少暴露以下纯函数供 Node 测试：

- `createInitialDraft()`。
- `searchDeck(deck, query, limit)`。
- `getSlotPlan(template, freeCount)`。
- `validateDraft(draft, moduleSpec)`。
- `buildReadingPayload(draft, cards)`。
- `buildConsultationPayload(draft, cards)`。
- `chooseSaveOperation(draft)`。
- `nextPhase(state, event)`。

DOM controller 不复制校验规则；Three.js 对象、DOM 节点、AbortController 和计时器不进入可序列化草稿。

## 8. 状态模型

```text
choosing_type
  → editing_details
  → choosing_spread_source
  → choosing_interpretation
  → acquiring_cards
  → confirming
  → saving
  → saved
  → generating (仅 now)
  → review_ready (完整且有问题)
  → review_saved
```

关键行为：

- 网站抽牌时向导暂时关闭，但 draft 保留在内存中。
- 用户主动终止当前 3D 咨询时，确认后清除 draft；已有数据库记录不删除。
- 保存失败返回确认页，可以修正后再次保存。
- 保存成功后生成失败，保留 reading/consultation ID，只重试模型。
- 审核失败保留输入内容和 interpretation ID，只重试 PUT。
- 页面刷新不恢复未保存草稿，避免把敏感问题写入 localStorage；界面在离开前按标准浏览器规则提醒。

## 9. 后端变化

- 新增 `consultation_modules.py`，保存模块注册和服务端验证规则。
- `consultation_service.py` 从模块注册表读取支持类型、允许牌阵和字段校验，不再维护孤立的硬编码集合。
- `GET /api/consultation-modules` 返回启用模块的公共描述。
- `POST /api/consultations` 同时接受 `inputMode=manual` 与 `inputMode=three_d`，并验证模块允许的牌阵。
- 现有 legacy SSE 桥保持兼容：旧 3D reading 如果在解读时才传问题，仍可自动创建 `three_d` consultation。
- 不新增 draft consultation 表；未完成牌阵前的问题只存在浏览器内存。
- `interpretation_action` 不进入数据库 Schema。

## 10. 错误处理

- 模块列表不可用：无问题快速抽牌仍可使用；普通咨询入口显示后端不可用，不伪造模块配置。
- 400：显示服务端中文 message，并定位到问题、背景、牌阵或牌位。
- 404：提示记录已删除；保留未保存草稿，允许重新开始。
- 409：提示同一 reading 正在解读，保留结果区并允许稍后重试。
- Ollama 不可用：保存仍成功，显示现有启动命令或云回退提示。
- SSE 中断：partial 版本留作调试，不进入 review-ready 或训练候选。
- 重复点击：saving、generating、review-saving 阶段禁用对应主按钮。
- 用户关闭：未保存草稿直接丢弃前提示；生成中关闭会 abort stream，并说明可能保留 partial 版本。

## 11. 可访问性与响应式

- 全屏向导使用 `role=dialog`、`aria-modal=true`。
- 打开后焦点进入标题，关闭后还给触发按钮；Tab 焦点限制在向导内。
- 桌面端使用左侧步骤、中央操作区、右侧摘要/结果三段布局。
- 低于 820px 改为单栏，底部固定主操作按钮。
- 牌位操作和正逆位按钮触控区域不小于 44px。
- 错误通过文字和 `aria-describedby` 关联，不只靠颜色。
- 正逆位同时使用文字、颜色和图片方向。
- 网站抽牌时当前咨询摘要在左侧状态区保持可见，但不遮挡牌面。

## 12. 测试策略

### 12.1 前端单元测试

覆盖：

- 无问题与普通咨询的状态转换。
- 模块允许牌阵过滤。
- 中文、英文和编号牌库搜索。
- 固定牌阵与 1–10 张自由牌阵计划。
- 问题/背景长度、缺牌、重复牌和正逆位类型。
- reading 与 consultation 两种 Payload。
- `three_d` 与 `manual` 只改变 input mode，不改变 module。
- `now`、`later`、`none` 的保存后动作。
- 保存失败不生成；生成失败不重复创建数据库记录。
- SSE 完成后获取最新 interpretation；partial 不进入审核。
- accepted/edited 的隐私状态和 edited 必填。

### 12.2 后端测试

覆盖：

- 模块公共注册接口。
- 普通咨询允许的牌阵和字段验证。
- `manual` 与 `three_d` consultation 原子创建。
- 无问题 reading 不产生 consultation。
- legacy SSE 自动建 consultation 仍兼容。
- 完整 consultation → interpretation → review → detail 记录图。
- 事务回滚和全量删除不留 orphan。

### 12.3 完整回归

- `python -m py_compile server.py consultation_service.py consultation_modules.py interpret_service.py`。
- `python -m unittest discover -s tests -v`。
- 运行全部 `tests/test_*.js`。
- CI/自动化中模型传输和 embedder 使用 mock，不依赖网络或 Ollama。

### 12.4 浏览器验收

使用本地服务器和实际浏览器分别检查：

- 普通咨询 + 手动录牌 + 立即解读 + 审核。
- 普通咨询 + 网站抽牌 + 仅保存。
- 无问题 + 网站抽牌 + 立即通用解读。
- 保存后模型不可用时的明确错误和重试。
- 390px 左右窄屏无横向溢出，主操作可触达。
- 关闭向导后，3D 牌库、鼠标/摄像头模式、主题、历史和旧解读入口仍正常。

本机 Ollama 可用时增加真实流式生成检查；不可用时仍必须验证保存、错误和重试路径，真实模型不替代 mock 自动化。

## 13. 分阶段交付

### 阶段 A：统一流程基础

- 模块注册表与查询接口。
- 统一新咨询向导。
- 无问题与普通咨询。
- 网站抽牌与手动录牌。
- 立即、稍后、仅保存。
- 解读与审核。

### 阶段 B：二选一

- 注册 `choice_compare`。
- 专属六张牌阵。
- 模块字段、Prompt overlay、安全规则和测试集。

### 阶段 C：即时传讯

- 注册 `symbolic_message`。
- 专属三张牌阵。
- 象征性声明、第三方读心防护和测试集。

### 阶段 D：数据导出与训练准备

- Canonical/SFT 导出。
- 隐私与安全过滤。
- 模块评测集和训练准备门槛。

## 14. 完成标准

阶段 A 完成需同时满足：

- 用户进入应用后先选择是否有问题，再选择牌阵、牌面来源和解读动作。
- 普通咨询的问题在抽牌前填写，牌阵完成后与 reading/cards 原子保存。
- 网站抽牌与手动录牌进入相同的保存、解读和审核链路。
- 无问题路径不伪造 consultation，仍可保存和执行通用 AI 解读。
- 立即、稍后和仅保存行为明确，生成失败不会重复保存。
- 模块注册表能够在不修改主流程的情况下加入二选一和即时传讯。
- 前端、后端、完整回归和桌面/窄屏浏览器验收通过。
- 原 3D、历史、主题、每日一牌和旧解读功能无可见回归。
