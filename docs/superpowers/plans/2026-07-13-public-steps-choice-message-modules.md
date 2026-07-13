# 前端业务步骤与二选一 / 即时传讯模块实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 隐藏咨询流程的内部状态名，以 7 个用户可理解的业务阶段展示进度，并在统一咨询流程中增加可由注册表驱动的“二选一”和“即时传讯”模块，覆盖前端校验、后端校验、专属牌阵、模块化提示词和安全检查。

**Architecture:** 保留现有 11 个内部 phase 作为状态机与失败恢复依据，在展示层映射为 7 个公开业务阶段。模块定义仍由 `consultation_modules.py` 作为后端单一事实来源，经 `/api/consultation-modules` 下发字段和牌阵约束；前端按注册表动态渲染，后端重新验证并生成规范化问题。解读服务从咨询记录读取模块上下文，将模块提示、安全规则和输出契约注入现有 Agent 链路。

**Tech Stack:** Python 3.10+ 标准库、SQLite、stdlib HTTP server、浏览器 JavaScript IIFE/CommonJS 测试导出、Three.js、CSS、Node `assert`、Python `unittest`。

---

## 约束与验收口径

- 不删除 `saving`、`saved`、`generating` 等内部 phase；它们继续负责幂等、重试和恢复。
- 前端不得显示任何原始 phase 文本，包括 `CHOOSING_TYPE`、`SAVED`、`GENERATING`、`REVIEW_READY`。
- 前端统一显示 `步骤 n / 7 · 中文业务阶段名`；保存和生成均归入相邻业务阶段，不新增可见步骤。
- `choice_compare` 显示名为“二选一”，使用 `choice_six` 六张牌阵，支持网页抽牌与手动录牌。
- `symbolic_message` 显示名为“即时传讯”，内部名称保留 `symbolic_message`，使用 `symbolic_message_three` 三张牌阵，支持网页抽牌与手动录牌。
- 二选一不替用户做决定，不宣称确定赢家；即时传讯明确是象征性反思，不声称读取第三方真实想法，不编造对方原话。
- 前端校验只改善体验；后端必须独立执行相同的必填、长度、允许牌阵和张数校验。

## Task 1：将内部 phase 映射为 7 个公开业务阶段

**Files:**
- Modify: `tests/test_consultation_flow.js`
- Modify: `js/consultation_flow.js`

**Step 1: 写失败测试**

在 `tests/test_consultation_flow.js` 中为导出的纯函数 `getPublicStep(phase, draft)` 添加表驱动测试，覆盖全部 11 个内部 phase：

```js
const expected = {
  choosing_type: [1, '选择咨询类型'],
  editing_details: [2, '填写咨询信息'],
  choosing_spread_source: [3, '选择牌阵与取牌方式'],
  choosing_interpretation: [4, '选择解读方式'],
  acquiring_cards: [5, '录入牌面'],
  confirming: [6, '确认本次咨询'],
  saving: [6, '确认本次咨询'],
  saved: [7, '结果与审核'],
  generating: [7, '结果与审核'],
  review_ready: [7, '结果与审核'],
  review_saved: [7, '结果与审核'],
};
```

同时增加静态断言，确认 `render()` 不再拼接原始 `${phase}` 或 `PHASES.indexOf(phase)` 作为用户文案。

**Step 2: 运行测试确认 RED**

Run: `node tests/test_consultation_flow.js`

Expected: FAIL，原因是 `getPublicStep` 尚未导出或仍显示原始 phase。

**Step 3: 最小实现**

在 `js/consultation_flow.js`：

- 新增不可变公开步骤表和 `getPublicStep(phase, draft)`。
- `acquiring_cards` 根据 `draft.spreadSource` 显示“抽取牌面”或“录入牌面”。
- 未知 phase 安全回退到第 1 步，不把未知字符串显示到页面。
- `render()` 使用 `步骤 ${index} / 7 · ${label}`。
- CommonJS 测试导出该函数。

**Step 4: 运行测试确认 GREEN**

Run: `node tests/test_consultation_flow.js`

Expected: PASS。

**Step 5: Commit**

```bash
git add js/consultation_flow.js tests/test_consultation_flow.js
git commit -m "fix: hide internal consultation phases"
```

## Task 2：扩展模块注册表与后端字段校验

**Files:**
- Modify: `tests/test_consultation_modules.py`
- Modify: `tests/test_consultation_service.py`
- Modify: `consultation_modules.py`
- Modify: `consultation_service.py`

**Step 1: 写注册表失败测试**

在 `tests/test_consultation_modules.py` 断言公开注册表包含三个启用模块：

- `general_reading`
- `choice_compare`
- `symbolic_message`

并断言：

- 二选一字段为 `optionA`、`optionB`、`decisionPriorities`，前两项必填，默认及允许牌阵仅为 `choice_six`。
- 即时传讯字段为 `relationshipContext`、`focus`，前者必填，默认及允许牌阵仅为 `symbolic_message_three`。
- 公开 API 不泄露 `prompt_overlay`、`output_contract`、`safety_rules` 等内部提示词。

**Step 2: 写服务层失败测试**

在 `tests/test_consultation_service.py` 增加：

- 缺少 `optionA` 或 `optionB` 时拒绝二选一。
- 选项超长、两个选项规范化后完全相同时拒绝。
- 合法二选一生成稳定、自然的中文 `user_query`，并保留规范化 `module_payload`。
- 缺少 `relationshipContext` 时拒绝即时传讯。
- 合法即时传讯生成包含“象征性反思”边界的 `user_query`，并保留可选 `focus`。
- 模块与牌阵不匹配时拒绝。

**Step 3: 运行测试确认 RED**

Run: `python -m unittest tests.test_consultation_modules tests.test_consultation_service -v`

Expected: FAIL，原因是模块未注册且 payload 未验证。

**Step 4: 最小实现**

在 `consultation_modules.py`：

- 为字段定义增加统一的 `key`、`label`、`type`、`required`、`maxLength`、`placeholder`。
- 注册二选一和即时传讯的中文名称、说明、专属牌阵、提示词覆盖、输出契约和安全规则。
- 提供内部查询函数给服务端使用，公开序列化继续剔除内部字段。

在 `consultation_service.py`：

- 按注册表验证模块是否启用。
- 将 `modulePayload` 限定为注册字段，去除首尾空白，检查必填与最大长度。
- 二选一拒绝相同选项并派生规范化问题。
- 即时传讯派生带边界声明的问题。
- 在持久化前验证 `spreadTemplate` 是否属于模块允许列表。
- 抛出既有 `ConsultationValidationError`，保持 HTTP 400 契约。

**Step 5: 运行测试确认 GREEN**

Run: `python -m unittest tests.test_consultation_modules tests.test_consultation_service -v`

Expected: PASS。

**Step 6: Commit**

```bash
git add consultation_modules.py consultation_service.py tests/test_consultation_modules.py tests/test_consultation_service.py
git commit -m "feat: register choice and symbolic message modules"
```

## Task 3：增加专属牌阵并验证固定张数

**Files:**
- Modify: `tests/test_spread_templates.js`
- Modify: `tests/test_consultation_service.py`
- Modify: `js/spread_templates.js`
- Modify: `consultation_service.py`

**Step 1: 写失败测试**

在 `tests/test_spread_templates.js` 断言：

- `choice_six` 存在、共六张，槽位名依次表达“共同核心、A 潜力、A 代价、B 潜力、B 代价、选择原则”。
- `symbolic_message_three` 存在、共三张，槽位名依次表达“情感氛围、未表达主题、你的边界与行动”。
- 每个位置具备合法的 `x`、`y`、`rotation`，可被现有 `SpreadLayout` 使用。

在 Python 测试中断言二选一只能保存六张、即时传讯只能保存三张。

**Step 2: 运行测试确认 RED**

Run: `node tests/test_spread_templates.js`

Run: `python -m unittest tests.test_consultation_service -v`

Expected: FAIL，原因是新模板和固定张数尚不存在。

**Step 3: 最小实现**

- 在 `js/spread_templates.js` 增加两个模板及适配桌面的紧凑坐标。
- 在 `consultation_service.py` 的固定张数表加入 `choice_six: 6`、`symbolic_message_three: 3`。
- 保持普通牌阵逻辑不变，不把专属模块牌阵加入首页默认牌阵轮播。

**Step 4: 运行测试确认 GREEN**

Run: `node tests/test_spread_templates.js`

Run: `python -m unittest tests.test_consultation_service -v`

Expected: PASS。

**Step 5: Commit**

```bash
git add js/spread_templates.js consultation_service.py tests/test_spread_templates.js tests/test_consultation_service.py
git commit -m "feat: add dedicated consultation spreads"
```

## Task 4：前端按模块注册表渲染字段并双层校验

**Files:**
- Modify: `tests/test_consultation_flow.js`
- Modify: `js/consultation_flow.js`
- Modify: `css/consultation_flow.css`

**Step 1: 写纯逻辑失败测试**

为以下导出函数添加测试：

- `getModuleFieldValue(draft, field)`：`userQuery` / `userContext` 从顶层读取，其余从 `modulePayload` 读取。
- `setModuleFieldValue(draft, field, value)`：不破坏未编辑字段。
- `validateModuleDetails(moduleSpec, draft)`：返回第一个中文错误，覆盖必填、长度、相同二选一选项。
- `buildConsultationPayload()`：二选一和即时传讯 payload 精确包含模块字段，不夹带其他模块残留数据。

增加静态集成断言，确认详情页遍历 `moduleSpec.inputFields`，不再只硬编码问题与背景两个输入框。

**Step 2: 运行测试确认 RED**

Run: `node tests/test_consultation_flow.js`

Expected: FAIL，原因是动态字段函数不存在。

**Step 3: 最小实现**

在 `js/consultation_flow.js`：

- 进入模块时清理不属于当前模块的 `modulePayload`。
- `renderDetailsStep()` 根据 `inputFields` 生成 `input` 或 `textarea`，保留标签、占位符、必填符号和字数限制。
- 统一字段读写路由；顶层通用字段和模块 payload 不混淆。
- 点击下一步时先执行注册表驱动校验，错误聚焦到对应字段。
- 切换模块后自动应用该模块默认牌阵；牌阵选择只显示允许项。
- 确认页显示二选一双方或即时传讯关系背景，不把对象输出成 `[object Object]`。

在 CSS 中为动态字段提示、错误态和六张牌说明增加最小样式，并维持当前可滚动布局。

**Step 4: 运行测试确认 GREEN**

Run: `node tests/test_consultation_flow.js`

Expected: PASS。

**Step 5: Commit**

```bash
git add js/consultation_flow.js css/consultation_flow.css tests/test_consultation_flow.js
git commit -m "feat: render consultation module fields"
```

## Task 5：把模块上下文接入 Agent 提示词与安全审查

**Files:**
- Modify: `tests/test_interpret_service.py`
- Modify: `tests/test_interpret_agent.py`
- Modify: `tests/test_server.py`
- Modify: `interpret_prompts.py`
- Modify: `interpret_service.py`
- Modify: `interpret_agent.py`
- Modify: `server.py`

**Step 1: 写提示词失败测试**

在 `tests/test_interpret_service.py` 增加：

- 二选一消息按“基础角色 → 模块规则 → 风格 → 检索证据 → 结构化输入 → 输出契约”组成。
- prompt 中包含 A、B 和决策关注点，但明确禁止替用户宣布唯一正确选择。
- 即时传讯 prompt 中包含关系背景和关注点，并明确禁止读取真实内心、编造原话、断言背叛或必然联系。
- 普通解读未传模块参数时输出保持兼容。

**Step 2: 写安全审查失败测试**

在 `tests/test_interpret_agent.py` 断言 critic 支持并可返回：

- `mind_reading`
- `fear_escalation`
- `fatalism`
- `high_stakes_overreach`

并验证这些 issue 会进入已有修订流程。

在 `tests/test_server.py` 断言生成请求从已保存咨询读取模块内部定义，使用模块 prompt version，而不是信任客户端提交的提示词。

**Step 3: 运行测试确认 RED**

Run: `python -m unittest tests.test_interpret_service tests.test_interpret_agent tests.test_server -v`

Expected: FAIL，原因是解读链路未接收模块上下文。

**Step 4: 最小实现**

- `interpret_prompts.build_messages()` 接收可选的 `module_overlay`、`module_payload`、`output_contract`、`module_safety_rules`。
- 结构化输入使用 JSON 序列化或稳定的中文字段行，不执行 payload 中的指令性文本。
- `interpret_service.interpret_reading_stream()` 向下透传这些参数，默认值保持普通解读兼容。
- `server.py` 根据已保存 `module_type` 从内部注册表取模块定义和 prompt version，再调用解读服务。
- `interpret_agent.py` 扩展 issue 白名单和 critic rubric；安全命中时明确要求修订为非宿命、非读心、可行动的表达。

**Step 5: 运行测试确认 GREEN**

Run: `python -m unittest tests.test_interpret_service tests.test_interpret_agent tests.test_server -v`

Expected: PASS。

**Step 6: Commit**

```bash
git add interpret_prompts.py interpret_service.py interpret_agent.py server.py tests/test_interpret_service.py tests/test_interpret_agent.py tests/test_server.py
git commit -m "feat: apply module-aware interpretation safety"
```

## Task 6：HTTP 集成、历史展示与文档同步

**Files:**
- Modify: `tests/test_server.py`
- Modify: `tests/test_api.js`
- Modify: `tests/test_consultation_flow.js`
- Modify: `js/history.js`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

**Step 1: 写端到端契约失败测试**

在 HTTP 测试中覆盖：

- `/api/consultation-modules` 返回三个启用模块及公开字段，无内部提示词。
- 手动六张二选一咨询创建成功；少一张、字段缺失、错误牌阵均为 400 且不产生孤儿 reading。
- 三维三张即时传讯咨询创建成功；字段缺失或错误牌阵为 400。
- 读取咨询详情后，`input_snapshot.moduleType`、`modulePayload`、牌位和解读关联均完整。

前端测试断言历史记录使用模块中文名称和关键摘要，不显示内部 module id。

**Step 2: 运行测试确认 RED**

Run: `python -m unittest tests.test_server -v`

Run: `node tests/test_api.js`

Run: `node tests/test_consultation_flow.js`

Expected: 至少一个新增断言 FAIL。

**Step 3: 最小实现**

- 修正服务器返回和事务顺序，确保所有验证在持久化前完成。
- 在 `js/history.js` 对新模块显示友好名称和摘要，缺失字段安全回退。
- `README.md` 更新三类咨询、两种取牌方式、公开 7 步流程及本地测试命令。
- `ARCHITECTURE.md` 更新注册表驱动字段、专属牌阵、模块提示词注入和双层校验边界。

**Step 4: 运行测试确认 GREEN**

Run: `python -m unittest tests.test_server -v`

Run: `node tests/test_api.js`

Run: `node tests/test_consultation_flow.js`

Expected: PASS。

**Step 5: Commit**

```bash
git add server.py js/history.js tests/test_server.py tests/test_api.js tests/test_consultation_flow.js README.md ARCHITECTURE.md
git commit -m "docs: complete consultation module integration"
```

## Task 7：全量验证与浏览器验收

**Files:**
- Verify only first; modify only the specific failing file if a regression is found.

**Step 1: Python 全量测试**

Run: `python -m unittest discover -s tests -v`

Expected: PASS。

**Step 2: JavaScript 全量测试**

Run each `tests/test_*.js` script with Node, stopping on first failure.

Expected: 14 个脚本全部 PASS。

**Step 3: 静态泄漏审计**

Run:

```powershell
rg -n "Step .*phase|SAVED|GENERATING|REVIEW_READY|CHOOSING_TYPE|EDITING_DETAILS" js Three.html css
```

Expected: 不存在面向用户的原始内部状态文案；常量或测试夹具中的合法引用需逐条人工确认。

**Step 4: 浏览器手动路径验收**

在工作树服务上依次验证：

1. 普通解读：保持原有问题可选逻辑。
2. 二选一 + 手动录牌：填写 A/B/关注点，录入六张，确认页摘要正确。
3. 二选一 + 网页抽牌：能进入六张牌阵并回到确认/解读。
4. 即时传讯 + 手动录牌：填写关系背景/关注点，录入三张。
5. 即时传讯 + 网页抽牌：能进入三张专属牌阵。
6. 任一路径生成时，顶部始终只显示公开中文步骤；保存、生成期间不出现 Step 8/9 或内部英文。
7. 在左栏、中央和右侧空白处滚轮均能到达底部保存按钮，确认滚动修复未回归。

**Step 5: 最终状态检查**

Run: `git status --short --branch`

Expected: 只有计划中的已提交变更，工作树干净。

**Step 6: 分支收尾**

使用 `superpowers:finishing-a-development-branch`，重新运行必要测试，按用户已授权的仓库流程合并并推送；不得触碰主目录中无关的用户文件。
