# Akashic Tarot

Akashic Tarot 是一个本地运行的 3D 塔罗交互应用：前端使用 Three.js 呈现卡牌舞台，MediaPipe Hands 支持摄像头手势，Python + SQLite 负责保存本地占卜记录。项目优先面向本地使用，不需要账号、不依赖云服务，也不需要前端构建步骤。

![黑夜模式主界面](docs/visuals/akashic-main-dark-mouse.png)

## 演示视频 / Demo

[![演示视频封面 — 对角层叠、牌阵、主题切换](docs/demo/akashic-tour-poster.jpg)](docs/demo/akashic-tour.mp4)

32 秒走完全部功能：闲置层叠 → POINT 悬停 → PINCH 拎起 → OPEN 发牌 → 翻 3 张 → 保存 → 黑白主题切换 → 回到空闲。点击上面海报打开完整 MP4，也可以看下面的 GIF 预览。

![动图预览](docs/demo/akashic-tour.gif)

## 功能概览

- 78 张塔罗牌 3D 卡组，闲置态为 **unveil.fr 风格的对角层叠 (diagonal cascade)**：鼠标滚轮或 TWO_FINGER 手势驱动滚动，POINT 悬停将该牌前推放大。
- **每张面朝上的牌都有自己跟随的名称标签**——一次翻多张也都有标注。
- **自由翻牌切换**：点击面朝上的牌会把它翻回去，不会因为误点而毁掉一张牌；保存阵改成顶栏 **保存 / Save** 按钮，一键记录所有当前翻开的牌。
- **黑夜 / 白天双主题**：顶栏图标或键盘 `T` 切换；首次访问跟随 `prefers-color-scheme`，选择保存到 `localStorage("akashic-theme")`；主页面和 `admin.html` 共享主题。
- **白天模式卡背更鲜艳**：卡背材质在白天模式下被涂上冷白底色加皇家蓝自发光，读起来是真正的白蓝 Rider-Waite 花纹而非泛黄旧纸。
- 鼠标模式和摄像头模式两套控制方式，摄像头模式可识别 OPEN、POINT、PINCH、FIST、TWO_FINGER 等手势。
- 支持三张牌、五张牌、凯尔特十字和自由牌阵。
- 每日一牌会按本地日期生成一条独立记录。
- 使用本地 SQLite 保存历史记录，后台页面除了视觉牌阵回放，**每行记录都带卡名 + 正/逆位 chips**，每张回放卡下方还有 **卡名 + 正/逆位字幕**。
- "清空数据库" 操作需要输入 `CLEAR` 二次确认。
- 包含前端交互、牌阵布局、手势识别、每日一牌和后端 API 测试。

## 界面示意

| 黑夜模式鼠标操作 | 摄像头模式等待态 | 后台记录页 |
| --- | --- | --- |
| ![鼠标模式截图](docs/visuals/akashic-main-dark-mouse.png) | ![摄像头模式截图](docs/visuals/akashic-main-dark-camera.png) | ![后台截图](docs/visuals/akashic-admin-dark.png) |

灵感借自 [unveil.fr](https://unveil.fr/?ref=godly) 的灯光语言：扁平表面 + 四角晕染径向光 + 浮层 backdrop-blur + 品牌字标暖色 drop-shadow。深色主题保留烛光金色 (`#E3BF74`)，浅色主题切换到 unveil 暖琥珀 (`#D97757`)。

```mermaid
flowchart LR
    A["选择控制方式"] --> B["浏览 78 张牌 (对角层叠)"]
    B --> C["选择牌阵"]
    C --> D["翻牌 (可来回切换)"]
    D --> E["顶栏 保存 / Save 写入 SQLite"]
    E --> F["后台查看与牌阵回放"]
```

## 快速开始

环境要求：

- Python 3.10 或更新版本
- 支持 WebGL 的现代浏览器
- 首次打开页面时需要联网加载 Three.js 和 MediaPipe CDN 脚本
- Node.js 仅用于运行 JavaScript 测试

启动本地服务：

```bash
python server.py
```

打开页面：

- 主应用：`http://localhost:8080/Three.html`
- 强制鼠标模式：`http://localhost:8080/Three.html?control=mouse`
- 强制摄像头模式：`http://localhost:8080/Three.html?control=camera`
- 后台记录页：`http://localhost:8080/admin.html`
- 健康检查：`http://localhost:8080/api/health`

如果需要保存历史记录，请通过 `python server.py` 启动服务后访问页面；直接双击 `Three.html` 只能运行静态页面，不能写入 SQLite。

## 操作说明

首次进入主应用时会选择控制方式，选择结果保存在浏览器 `localStorage` 中，也可以通过 URL 参数强制指定。

| 模式 | 操作 |
| --- | --- |
| 鼠标模式 | 移动鼠标指向卡牌，左键点击翻看 / 再点击翻回，**鼠标滚轮**滚动层叠，右键收回所有预览，按顶栏 **保存 / Save** 写入牌阵。 |
| 摄像头模式 | 允许浏览器使用摄像头后，通过 OPEN、POINT、PINCH、FIST、TWO_FINGER 控制选牌、确认和继续。 |
| 主题切换 | 点击顶部主题按钮，或按键盘 `T` 在黑夜 / 白天主题之间切换；主页面和后台共享偏好。 |

常用手势：

| 手势 | 状态 | 行为 |
| --- | --- | --- |
| OPEN | 空闲 | 开始当前牌阵。 |
| POINT | 空闲 | 暂停层叠并把指向的牌向前突出。 |
| PINCH | 空闲 / 牌阵中 | 拾起并查看卡牌。 |
| FIST | 持牌时 | 确认当前卡牌并写入本次牌阵。 |
| TWO_FINGER | 空闲 | 左右滑动滚动对角层叠。 |
| OPEN / FIST | 牌阵完成提示 | OPEN 继续下一阵，FIST 结束并返回空闲状态。 |

## 主题与色板

| Token | 黑夜 / Dark | 白天 / Light |
| --- | --- | --- |
| `--surface` | `#0a0506` | `#fafaf7` |
| `--accent` | `#e3bf74`（烛光金） | `#d97757`（unveil 暖琥珀） |
| 动作按钮背景 | 深酒红泥色 | 鹅黄 `#fbe7a4` + 深琥珀描边 |

## 本地数据与后台

后端会自动创建本地数据库：

```text
data/tarot.sqlite3
```

数据库包含两类核心数据：

- `readings`：每次牌阵或每日一牌的记录，包括类型、牌阵名称、日期和创建时间。
- `reading_cards`：每条记录中的卡牌，包括位置、位置含义、中文名、英文名、图片文件和正逆位。

后台页面 `admin.html` 可以查看最近记录、视觉回放已保存牌阵（每张回放卡下面带名字 + 正/逆字幕，列表每行带 chips），并提供清空数据库功能。清空操作需要输入 `CLEAR` 二次确认；该操作只影响本地 SQLite 文件。

## API

所有接口由 `server.py` 提供。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 检查后端和数据库状态。 |
| `POST` | `/api/readings` | 保存一次完成的牌阵。 |
| `GET` | `/api/readings?limit=20` | 获取最近记录。 |
| `GET` | `/api/readings/{id}` | 获取单条记录和卡牌详情。 |
| `DELETE` | `/api/readings` | 清空本地记录并重置 id。 |
| `GET` | `/api/daily-draw?date=YYYY-MM-DD` | 获取指定日期的每日一牌。 |
| `POST` | `/api/daily-draw` | 创建或返回指定日期的每日一牌。 |

保存记录示例：

```json
{
  "kind": "spread",
  "templateKey": "three_timeline",
  "templateName": "三张牌 / Past Present Future",
  "readingDate": "2026-04-25",
  "spreadNumber": 1,
  "cards": [
    {
      "slot": 1,
      "slotLabel": "过去 / Past",
      "cardId": 0,
      "zh": "愚人",
      "en": "The Fool",
      "imageFile": "RWS_Tarot_00_Fool.jpg",
      "isReversed": false
    }
  ]
}
```

## 测试

运行 JavaScript 行为测试：

```bash
node tests/test_mouse_interaction.js
node tests/test_main_ui_state.js
node tests/test_spread_layout.js
node tests/test_spread_templates.js
node tests/test_reading_replay.js
node tests/test_admin_helpers.js
node tests/test_deck_order.js
node tests/test_daily_draw.js
node tests/test_input_mode.js
node tests/test_reading_orientation.js
```

检查 JavaScript 语法：

```powershell
Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName }
```

运行后端测试：

```bash
python -m unittest tests.test_server -v
```

## 项目结构

```text
taluo/
├── Three.html          # 主应用
├── admin.html          # 本地历史记录后台
├── server.py           # 静态服务 + SQLite API
├── css/
│   ├── tokens.css      # CSS 变量（按 [data-theme] 分组）
│   ├── base.css        # html / body 基础样式
│   ├── components.css  # 通用组件：顶栏、按钮、面板
│   ├── theme.css       # 四角晕染、雾效层和白天模式样式覆盖
│   ├── tarot.css       # 主页面专属
│   ├── admin.css       # 后台页专属
│   └── responsive.css  # 响应式补丁
├── assets/textures/    # 本地纹理素材
├── data/.gitkeep       # 运行时 SQLite 数据库目录
├── docs/
│   ├── demo/           # 32s 演示 MP4 + GIF + 海报
│   └── visuals/        # 截图和概念图
├── image2/             # 卡背 + 78 张塔罗牌图
├── js/
│   ├── api.js          # API 客户端，含离线降级
│   ├── admin.js        # 后台 UI（行内 chips + 回放字幕）
│   ├── carousel.js     # 对角层叠卡组（unveil.fr 风格）
│   ├── daily_draw.js   # 每日一牌
│   ├── deck.js         # 卡牌定义
│   ├── deck_order.js   # 闲置态洗牌
│   ├── gesture.js      # 手势分类与稳定化
│   ├── history.js      # 历史记录捕获与渲染
│   ├── input_mode.js   # 摄像头 / 鼠标模式选择
│   ├── main.js         # Three.js 场景、按主题调灯、滚轮处理
│   ├── main_ui_state.js # 顶栏主按钮状态机
│   ├── mediapipe.js    # MediaPipe 摄像头集成
│   ├── mouse_interaction.js # 点击翻 / 翻回的解析器
│   ├── particles.js    # 灰烬粒子效果
│   ├── reading_replay.js # 后台牌阵回放
│   ├── spread.js       # 牌阵状态机与交互
│   ├── spread_flow.js  # 牌阵流程小型纯函数
│   ├── spread_layout.js # 响应式牌阵布局
│   ├── spread_templates.js # 牌阵模板定义
│   ├── state.js        # 共享运行时状态
│   ├── theme.js        # 黑白主题控制 + 持久化
│   ├── ui.js           # 每张卡的浮动标签池
│   └── utils.js        # 纹理与清理工具
└── tests/              # 前后端行为测试
```

## 开源说明

- 项目代码使用 MIT License，详见 [LICENSE](LICENSE)。
- `image2/` 中的卡牌图片用于本地演示，图片权利可能与项目代码许可证不同；再次分发前请确认对应素材授权。
- 摄像头手势需要浏览器摄像头权限。
- 默认页面会从公共 CDN 加载 Three.js 和 MediaPipe。
