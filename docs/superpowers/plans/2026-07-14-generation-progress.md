# Interpretation Generation Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在咨询流程的解读生成阶段显示柔和、持续且可访问的不确定进度动画，直到生成结束。

**Architecture:** 继续使用 `js/consultation_flow.js` 的状态驱动渲染；`generating` 页面负责输出语义化进度结构，`css/consultation_flow.css` 负责视觉动画与减少动态效果。现有流式请求、取消按钮、错误处理和后端协议保持不变。

**Tech Stack:** 原生 JavaScript、CSS、Node.js `assert` 测试、Python `unittest`

---

### Task 1: 增加生成状态的语义化进度结构

**Files:**
- Modify: `tests/test_consultation_flow.js`
- Modify: `js/consultation_flow.js:923-935`

- [ ] **Step 1: 写入失败的生成状态 DOM 测试**

在 `tests/test_consultation_flow.js` 中新增测试：

```javascript
async function testGenerationProgressFeedback() {
    const { browserFlow, testFlow, nodes } = loadControllerRuntime();
    browserFlow.mount();
    await browserFlow.open();
    testFlow.setDraftForTest({
        ...completeDraft(),
        phase: 'generating',
        saved: { consultationId: 17, readingId: 29 },
        streamContent: '正在输出的解读'
    });

    const mount = nodes['consultation-flow-mount'];
    const status = findFakeNode(
        mount,
        node => node.className === 'consultation-generation-status'
    );
    const progress = findFakeNode(
        mount,
        node => node.getAttribute && node.getAttribute('role') === 'progressbar'
    );
    const indicator = findFakeNode(
        mount,
        node => node.className === 'consultation-generation-progress-bar'
    );
    const stop = findFakeNode(
        nodes['consultation-flow-actions'],
        node => node.tagName === 'BUTTON' && node.textContent === '停止生成'
    );

    assert.ok(status);
    assert.strictEqual(status.getAttribute('role'), 'status');
    assert.strictEqual(status.getAttribute('aria-live'), 'polite');
    assert.ok(findFakeNode(
        status,
        node => node.textContent === '正在分析牌面并组织回答，请稍候…'
    ));
    assert.ok(progress);
    assert.strictEqual(progress.getAttribute('aria-label'), '解读生成中');
    assert.strictEqual(progress.getAttribute('aria-valuenow'), null);
    assert.strictEqual(indicator.getAttribute('aria-hidden'), 'true');
    assert.ok(stop);
}
```

把测试注册到测试数组：

```javascript
['generation progress feedback', testGenerationProgressFeedback],
```

- [ ] **Step 2: 运行测试并确认正确失败**

Run: `node tests/test_consultation_flow.js`

Expected: `generation progress feedback` 失败，因为页面还没有 `.consultation-generation-status` 与进度条。

- [ ] **Step 3: 在生成页面加入最小 DOM 实现**

将 `renderGenerationStep` 改为：

```javascript
function renderGenerationStep(mountNode, actionsNode) {
    const progressStatus = el('div', {
        className: 'consultation-generation-status',
        role: 'status',
        'aria-live': 'polite'
    }, [
        el('p', {
            className: 'consultation-generation-message',
            textContent: '正在分析牌面并组织回答，请稍候…'
        }),
        el('div', {
            className: 'consultation-generation-progress',
            role: 'progressbar',
            'aria-label': '解读生成中'
        }, [
            el('span', {
                className: 'consultation-generation-progress-bar',
                'aria-hidden': 'true'
            })
        ])
    ]);

    mountNode.append(el('section', { className: 'consultation-result-panel' }, [
        el('h3', { textContent: '正在生成解读' }),
        progressStatus,
        el('article', {
            className: 'consultation-stream-result',
            ariaLive: 'polite',
            textContent: streamContent
        })
    ]));
    actionsNode.append(actionButton('停止生成', () => {
        if (abortController) abortController.abort();
    }));
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node tests/test_consultation_flow.js`

Expected: `Consultation flow tests: 52/52 passed`。

- [ ] **Step 5: 提交 DOM 与测试**

```powershell
git add js/consultation_flow.js tests/test_consultation_flow.js
git commit -m "feat: show interpretation generation progress"
```

---

### Task 2: 实现柔和动画与减少动态效果

**Files:**
- Modify: `tests/test_consultation_flow.js:519-565`
- Modify: `css/consultation_flow.css`

- [ ] **Step 1: 扩展 CSS 合约测试**

在 `testConsultationFlowCssContract()` 中加入：

```javascript
assert.match(
    css,
    /\.consultation-generation-progress\s*\{[^}]*overflow:\s*hidden;[^}]*background:\s*color-mix\([^}]+var\(--panel-line\)/s
);
assert.match(
    css,
    /\.consultation-generation-progress-bar\s*\{[^}]*animation:\s*consultation-progress-drift 1\.8s ease-in-out infinite;/s
);
assert.match(css, /@keyframes\s+consultation-progress-drift\s*\{/);
assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.consultation-generation-progress-bar\s*\{[^}]*animation:\s*none;[^}]*transform:\s*none;/
);
```

- [ ] **Step 2: 运行测试并确认 CSS 合约失败**

Run: `node tests/test_consultation_flow.js`

Expected: `consultation flow CSS contract` 失败，因为进度条样式和动画尚未定义。

- [ ] **Step 3: 加入低对比度进度条样式**

在 `css/consultation_flow.css` 中加入：

```css
.consultation-generation-status {
    display: grid;
    gap: 10px;
}

.consultation-generation-message {
    margin: 0;
    color: color-mix(in oklch, var(--ink-text) 68%, transparent);
}

.consultation-generation-progress {
    position: relative;
    height: 6px;
    overflow: hidden;
    background: color-mix(in oklch, var(--panel-line) 55%, transparent);
    border: 1px solid color-mix(in oklch, var(--panel-line) 76%, transparent);
    border-radius: 999px;
}

.consultation-generation-progress-bar {
    position: absolute;
    inset-block: 0;
    width: 42%;
    background: color-mix(in oklch, var(--accent) 58%, transparent);
    border-radius: inherit;
    animation: consultation-progress-drift 1.8s ease-in-out infinite;
}

@keyframes consultation-progress-drift {
    0% { transform: translateX(-115%); }
    50% { transform: translateX(75%); }
    100% { transform: translateX(245%); }
}

@media (prefers-reduced-motion: reduce) {
    .consultation-generation-progress-bar {
        inset-inline: 10%;
        width: 80%;
        animation: none;
        transform: none;
        opacity: 0.65;
    }
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node tests/test_consultation_flow.js`

Expected: `Consultation flow tests: 52/52 passed`。

- [ ] **Step 5: 提交动画样式与测试**

```powershell
git add css/consultation_flow.css tests/test_consultation_flow.js
git commit -m "style: animate interpretation progress"
```

---

### Task 3: 全量回归与本地交付检查

**Files:**
- Verify only; no production file changes expected

- [ ] **Step 1: 运行全部 Python 测试**

Run: `D:\Anaconda\python.exe -m unittest discover -s tests -p test_*.py`

Expected: `Ran 139 tests` and `OK`。

- [ ] **Step 2: 运行全部 JavaScript 测试套件**

Run:

```powershell
$files = Get-ChildItem tests\test_*.js | Sort-Object Name
foreach ($file in $files) {
    & node $file.FullName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: 14 个 JavaScript 测试文件全部退出码为 `0`，其中咨询流程为 `52/52 passed`。

- [ ] **Step 3: 检查工作区和差异**

Run:

```powershell
git diff --check
git status --short --branch
git log -5 --oneline --decorate
```

Expected: `git diff --check` 无输出；分支为 `fix/review-panel-scroll`；没有未提交的功能代码。

- [ ] **Step 4: 保持本地，不推送**

不要执行 `git push`。将测试结果、提交号和本地分支状态报告给用户，等待用户决定是否合并。
