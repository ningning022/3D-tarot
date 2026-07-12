# 中文手动录牌工作台设计

日期：2026-07-12

状态：已批准

范围：`general_reading` 普通咨询的完整前端闭环

## 1. 目标

在不改变现有 3D 抽牌流程的前提下，为使用实体塔罗牌的用户提供一个中文手动录牌入口。用户可以输入问题与背景、选择牌阵、录入牌名和正逆位、确认并保存咨询、调用现有本地 Agent 获得流式解读，最后对结果进行人工审核。

本阶段交付一条可实际使用的数据生产闭环：

```text
打开手动工作台
  → 输入问题与背景
  → 选择牌阵并录入实体牌
  → 确认后原子保存 consultation + reading + cards
  → 使用保存的 reading_id 启动 SSE 解读
  → 接受、需要改进、拒绝或编辑答案
  → 保存人工审核
```

第一版固定使用 `module_type=general_reading`。二选一和即时传讯继续保留在后续模块阶段，不在本工作台中显示占位入口。

## 2. 方案选择

采用集成式全屏工作台：在 `Three.html` 顶栏增加“手动解读”入口，打开覆盖 3D 舞台的全屏面板。

没有采用独立 `manual.html`，因为它会重复顶栏、主题和解读基础设施；没有放进 `admin.html`，因为后台的核心职责是历史查看和设置，不应混合创建咨询的主流程。

全屏面板复用现有主题变量、`FULL_DECK`、`SpreadTemplates`、`TarotAPI` 和 `AkashicInterpret.streamInterpretation()`。3D renderer 可以继续运行，但工作台打开时锁住页面滚动，并通过最高交互层阻止舞台接收鼠标和键盘操作。

## 3. 用户流程

### 3.1 入口与退出

- 顶栏增加 `手动解读 / Manual` 按钮。
- 工作台以 `role=dialog`、`aria-modal=true` 的全屏面板打开。
- 关闭后回到原来的 3D 状态，不重置正在浏览的牌库或主题。
- 未提交草稿可以直接关闭；保存或生成进行中时关闭需要二次确认。
- 按 `Escape` 关闭，生成中同样执行二次确认。

### 3.2 四步工作流

#### 第一步：问题

- 中文问题必填，去除首尾空白后长度为 4–500 字。
- 背景可选，长度不超过 1000 字。
- 背景输入框旁提示不要填写真实姓名、电话、住址、身份证号等敏感信息。
- 默认解读风格为 `psychological`，用户可选 `traditional`、`intuitive` 或 `psychological`；语言固定为中文。

#### 第二步：牌阵与录牌

- 支持现有四种牌阵：`three_timeline`、`five_cross`、`celtic_cross` 和 `free`。
- 固定牌阵自动生成对应数量和牌位名称。
- 自由牌阵要求用户选择 1–10 张，默认 3 张；修改数量时保留仍在范围内的已录入牌。
- 每个牌位显示搜索框、候选列表、所选牌缩略图、中文/英文名、编号和正逆位开关。
- 搜索支持中文名、英文名和从 0 开始的牌编号；匹配不区分英文大小写，最多显示 12 个候选。
- 同一咨询中禁止重复录入同一 `cardId`。
- 正逆位必须明确，默认正位，但 UI 始终显示当前状态，不用缺省值表达正位。
- 已选牌可以替换或清除；固定牌阵顺序由牌位决定，不提供拖拽排序。

#### 第三步：确认

- 汇总显示问题、背景、风格、牌阵和全部牌位。
- 牌面缩略图按正逆位旋转，文字同时显示“正位 / 逆位”，不能仅靠旋转传达状态。
- 提交前再次运行完整客户端校验。
- 点击“保存并解读”后锁定提交按钮，避免重复创建咨询。

#### 第四步：解读与审核

- 成功创建咨询后立刻使用返回的 `readingId` 调用 SSE 解读，不在请求中再次传入问题。
- 流式文本实时追加；显示当前阶段、停止按钮和可重试错误。
- 停止或浏览器中断产生的 partial 版本保留在数据库中，但不能审核为训练候选。
- 生成成功后重新读取 `GET /api/consultations/<id>`，以服务端最新 interpretation 作为审核对象。
- 支持重新生成；每次生成都是新的 interpretation，旧版本与旧审核不覆盖。

## 4. 人工审核交互

审核区提供四种结论：

- `accepted`：接受模型原回答。
- `needs_work`：标记需要改进。
- `rejected`：拒绝该版本。
- `edited`：将用户编辑后的文本作为理想答案。

公共字段：

- 可选评分 1–5。
- 可多选问题标签：不回应问题、牌义错误、机械罗列、空泛套话、过度宿命、擅测他人想法、建议不可执行、语气不合适、事实或安全风险、其他。
- 可选审核备注。

条件字段：

- `edited` 必须填写非空的理想答案。
- `accepted` 和 `edited` 显示“已确认隐私，可作为本地训练候选”复选框。未勾选仍可保存审核，但不会满足后续导出资格。
- `needs_work` 和 `rejected` 默认不确认隐私，也不进入 SFT 候选。

审核保存成功后显示服务端返回的更新时间和结论。再次修改同一版本时使用现有 PUT 接口更新当前审核。

## 5. 前端架构

### 5.1 新文件

- `js/manual_reading.js`：纯状态逻辑、校验、Payload 构建、DOM 控制和 SSE/审核编排。
- `css/manual_reading.css`：全屏工作台、牌位编辑器、确认页、流式结果、审核区和响应式布局。
- `tests/test_manual_reading.js`：在 Node VM 中测试纯函数和关键网络编排，不依赖浏览器或模型。

### 5.2 修改文件

- `Three.html`：增加顶栏入口、全屏 dialog 容器、样式和脚本引用。
- `js/api.js`：增加 `createConsultation`、`loadConsultation` 和 `reviewInterpretation`；错误对象保留服务端返回的中文 message。
- `tests/test_server.py`：补足手动咨询 → interpretation → review → detail 的后端集成断言。
- `README.md`：增加入口、操作步骤和限制说明。

### 5.3 模块边界

`manual_reading.js` 使用 IIFE 暴露 `window.ManualReading`，同时支持 `module.exports` 供 Node 测试。

公开的纯函数至少包括：

- `searchDeck(deck, query, limit)`：牌库搜索。
- `getSlotPlan(templateKey, freeCount)`：生成牌位计划。
- `validateDraft(draft)`：返回字段级错误，不直接操作 DOM。
- `buildConsultationPayload(draft, deck)`：生成后端需要的 JSON。
- `createInitialDraft()`：创建无共享引用的新草稿。

公开的浏览器方法为：

- `mount()`：绑定入口和渲染工作台。
- `open()` / `close()`：控制全屏工作台。
- `reset()`：清理当前草稿和已创建咨询引用。

纯逻辑不读取全局 DOM，DOM controller 不复制校验规则。

## 6. 状态模型

工作台使用单一状态对象，关键阶段为：

```text
editing_question
  → editing_cards
  → confirming
  → saving
  → generating
  → review_ready
  → review_saved
```

异常状态不销毁已成功创建的数据：

- `saving` 失败：返回确认页，可修正并重新创建。
- `generating` 失败：保留 `consultationId` 和 `readingId`，只重试 SSE，不再次 POST consultation。
- `review` 失败：保留当前编辑内容和 interpretation ID，仅重试 PUT。
- 重置操作清理前端状态，但不删除已落库记录，并在界面明确提示。

状态对象只保存 JSON 可序列化值；AbortController、DOM 节点和计时器由 controller 独立持有。

## 7. API 数据流

创建咨询：

```text
ManualReading.buildConsultationPayload()
  → TarotAPI.createConsultation()
  → POST /api/consultations
  ← { id, readingId, ... }
```

生成解读：

```text
AkashicInterpret.streamInterpretation(readingId, { style, language: "zh" })
  → POST /api/interpret/<readingId>
  ← SSE chunk / done / error
  → TarotAPI.loadConsultation(consultationId)
  ← interpretations[0]
```

保存审核：

```text
TarotAPI.reviewInterpretation(interpretationId, reviewPayload)
  → PUT /api/interpretations/<interpretationId>/review
  ← persisted review
```

服务端仍是问题、牌阵、生成版本和审核的唯一事实来源。前端确认页只展示待提交草稿，生成阶段不从草稿临时覆盖服务端问题。

## 8. 错误处理

- API 400：显示服务端校验 message，并尽量定位到问题、背景、牌阵或牌位。
- API 404：提示记录已删除，保留当前草稿并允许重新开始。
- API 409：提示同一 reading 正在生成，保留结果区并允许稍后重试。
- Ollama 未启动或模型缺失：复用现有错误文案和启动命令。
- 网络断开：显示“咨询已保存 / 尚未保存”的明确状态，避免用户误以为数据丢失或重复提交。
- SSE malformed frame：沿用现有容错解析；只有 `done=true` 后才进入 `review_ready`。
- 所有按钮在异步期间防重复点击，错误后恢复可操作状态。

## 9. 可访问性与响应式

- 桌面端使用左右双栏：左侧步骤与录牌，右侧摘要或解读。
- 宽度低于 820px 时改为单栏，底部固定当前步骤的主操作按钮。
- 牌位编辑器在窄屏中保持不小于 44px 的点击区域。
- 所有输入都有可见 label；错误通过文字和 `aria-describedby` 关联，不只用颜色。
- dialog 打开后把焦点移到标题；关闭后还给入口按钮。
- Tab 焦点限制在工作台内；Escape 遵循生成中确认规则。
- 正逆位同时由文字、颜色和牌面方向表达。

## 10. 测试与验收

### 10.1 前端自动化

`tests/test_manual_reading.js` 覆盖：

- 中文、英文、编号搜索与最大候选数。
- 固定牌阵和 1–10 张自由牌阵的牌位计划。
- 问题长度、背景长度、缺牌、重复牌和正逆位类型校验。
- Payload 中的 module、input mode、模板、牌位、cardId 和图片字段。
- 保存失败不进入生成，生成失败不重复创建 consultation。
- SSE 完成后加载最新 interpretation。
- edited 缺少内容时阻止 PUT，accepted/edited 的隐私状态正确传递。

### 10.2 后端与回归

- 保留现有咨询 Schema、事务回滚、SSE 绑定和审核测试。
- 增加一次完整的服务层记录图断言，确认 detail 返回 reading、interpretation 和 review。
- 运行 `python -m py_compile`。
- 运行完整 `python -m unittest discover -s tests -v`。
- 运行全部 `tests/test_*.js`。

### 10.3 浏览器验收

使用本地服务器和实际浏览器检查：

- 桌面端完成三张牌手动咨询并看到流式结果或明确的 Ollama 降级错误。
- 搜索、替换、清除、正逆切换、重复牌拦截和确认摘要正确。
- 审核保存后，重新读取咨询能看到相同审核。
- 390px 左右窄屏下无横向溢出，主要操作可触达。
- 关闭工作台后，3D 牌库、鼠标模式、主题切换和原有解读入口仍可使用。

浏览器检查中若本机 Ollama 不可用，仍必须验证保存成功、错误状态和重试路径；真实模型端到端生成作为环境允许时的附加验收，不替代 mock 自动化测试。

## 11. 完成标准

本阶段完成需同时满足：

- 用户无需经过 3D 抽牌即可录入实体牌并创建中文普通咨询。
- 保存后使用服务端咨询问题进行 SSE 解读，不产生重复 consultation。
- 每个完整生成版本可以在同一工作台接受、标错、拒绝或编辑。
- 前后端自动化测试和完整回归通过。
- 桌面与窄屏浏览器流程通过，原 3D 功能无可见回归。
- 二选一、即时传讯、数据集导出和 QLoRA 没有被提前耦合进本工作台。
