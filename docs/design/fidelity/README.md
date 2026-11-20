# 画面精度打磨：字体、图标、贴图与细节（fidelity）

2026-11-20 · 用户反馈：“当前发现字体、贴图这些有点粗糙，页面细节还原度要再看下”，以及“贴图还包括树木这些，就很粗糙”。

只改表现层：不动规则、AI、内容数值与存档格式（`npm run check:plan` 显示 smoke `skip`：没有改动落在规则的导入闭包内）。三套画风都受益，绘卷（`?theme=painted`）优先。截图都是 DPR 2、1280 × 900，左为改前（main 75ddda7）、右为改后，见本目录：

| 目录 | 内容 |
| --- | --- |
| `ui/` | `<before|after>-<painted|flat>-1280-<full|top|city|unit|actions|goals>.png`（整页与顶栏、城市面板、单位面板、行动栏、开局目标特写），绘卷另有 `research` / `world` |
| `sprites/` | 大头像两种方案的对比（见 §3） |
| `icons/` | 绘卷矢量图标总表 `vector-sheet.png` 与改前改后 |
| `map/` | 地图特写：森林边缘、山脉、海岸、城镇，缩放 1.5 与最大缩放，绘卷与平面 |

## 1. 字体与字号

**字体角色**（`src/styles.css` 的 `:root`，画布文字用 `src/browser/theme.ts` 的 `FONT_UI` / `FONT_DISPLAY` 同一套字体栈）：

| 角色 | 变量 | 字体栈（只用系统字体，不打包、不外链） |
| --- | --- | --- |
| 界面无衬线 | `--font-ui` | PingFang SC → Hiragino Sans GB → Microsoft YaHei UI / YaHei → Noto Sans CJK SC / Noto Sans SC / Source Han Sans SC → 文泉驿微米黑 → system-ui |
| 数字 | `--font-ui` + `font-variant-numeric: tabular-nums`（全局） | 与中文同一字族的等宽数字：计数、费用、产出对齐，数值变化时不跳动 |
| 标题（绘卷） | `--font-display` → `--font-serif` | Noto Serif CJK SC / Noto Serif SC / Source Han Serif → 宋体（Songti SC、STSong、SimSun）。像素画风的 `--font-display` 仍是界面无衬线 |

为什么这样选：原来的栈把 Avenir Next / Trebuchet MS 放在最前，Mac 以外的机器上这些字体不存在，拉丁字母和数字就各自回退到不同的字体（截图里“1 / 200”是衬线、“40 × 26”是 DejaVu 无衬线，和旁边的中文都不是一家）。现在中文字体排在最前，拉丁字母和数字跟着中文用同一字族；PingFang、雅黑、Noto CJK 自带的拉丁字形质量足够。唯一的例外是“·”和“×”：CJK 字体把它们画成全角，“城市 1 · 人口 2”中间会空出一大块，所以加了一个只覆盖 U+00B7、U+00D7 的 `@font-face "UI Latin Marks"`，用 `local()` 取本机的 Helvetica Neue / Segoe UI / Arial / Liberation Sans / DejaVu Sans，不下载任何文件。没有自托管字体：要让中文、拉丁和数字同源，得打包一套 CJK 子集（几 MB 起），与“包体保持合理”冲突，收益又不如直接用系统 CJK 字体。

**字号阶梯**（px）：

| 档 | 变量 | 用途 |
| --- | --- | --- |
| 11 | `--text-tag` | 绝对下限，只给小标签：数字角标、按键提示、“文明 6：…”提示签、阵营 / 总部徽章、移动点胶囊 |
| 12 | `--text-xs`（`--text-sm` 同值） | 中文最小字号：说明、图例、次要标签、页签 |
| 13 | `--text-md` | 次要正文 |
| 14 | `--text-body` | 正文 |
| 16 | `--text-lg` | 小标题 |
| 20 | `--text-xl` | 面板标题 |
| 28 | `--text-2xl` | 大数字 / 展示 |

- 所有游戏样式表里 8–10.5px 的字号已清零：中文文本升到 12px，纯数字 / 按键的小签停在 11px；未设字号的 `<small>` 不低于 12px（`max(.85em, 12px)`）。
- 字重只用 400 / 500 / 600 / 700：原来的 650 → 600，750 / 800 → 700（Noto CJK 在 Linux 上把 750 以上映射成 Black，过粗；PingFang 最粗只有 600）。12px 的页签用 500。
- `font-synthesis: none`（不合成假粗体 / 斜体）、`-webkit-font-smoothing: antialiased`（深底浅字更干净）、`text-rendering: optimizeLegibility`、`font-kerning: normal`、全局行高 1.4（段落 1.55）。
- 中文段落、列表、`<small>` 用 `text-wrap: pretty`，换行时不再把单个字留在末行（开局目标卡的“市”“良”）。
- 字距只保留在原有的标题与小标签上，不新增。

## 2. 图标

绘卷画风有一套原创矢量图标（24 × 24 视图框，统一的深墨描边、高光与圆角接头，配色沿用像素版的含义色并贴合胡桃木 / 黄铜 / 青瓷釉）。接入在 `src/browser/ui-icons.ts`：`applyTheme` 调用 `setIconStyle('vector' | 'pixel')`，`uiIcon` / `statChip` / `typeBadge` / `flagImage` / `iconUrl` 在矢量模式下返回矢量 data URL，没有矢量版本的名字退回像素图；调用方不需要改。覆盖：产出与资源（食物、生产、金币、科研、文化、信仰、满意度）、轮数与加急沙漏、城市计划、三种球、精华与七种属性精华、单位数值（攻击、防御、移动、射程、HP、药、护盾）、交锋、奖杯、星、勾、锁、图鉴、地图、解锁种类（建筑、单位、设施区、改良、奇观、规章）、世代分、徽章、施工、特训、招式学习器、定位、前往、建城点、旗帜（可换色）、18 种属性徽章与道馆徽章、7 种兵种盾、4 种秘传，以及行动栏的 `action:*`。总表：`icons/vector-sheet.png`（每格从左到右 48 / 24 / 16 px 矢量与对应的像素原图）。

平面与 2.5D 继续用像素图标，但按设备像素整数倍绘制：`uiIcon` 取 `devicePixelRatio`，每格取 `max(1, round(尺寸 × DPR / 格数))` 个设备像素（`pixelIconBox`）：例如 12 格图标请求 16px 时，DPR 1 下画成 12px（每格 1 像素），DPR 2 下画成 18px（每格 3 个设备像素），并且 `.px-icon` 用 `image-rendering: pixelated`。行动栏图标在绘卷下为 20px 矢量，像素画风 18px。运行中切换画风后，之后重新渲染的面板使用新图标。

## 3. 宝可梦贴图与大头像

- **整数倍缩放**：固定画布的像素贴图（第 3 世代 64px、第 4 世代 80px、第 5 世代 96px）在界面里一律按“放得下的最大整数倍设备像素”绘制，居中放在原来的格子里，布局不变（`artFit`，`src/browser/ui-icons.ts`；`artImage`、`pokemonPortrait`、`spriteImage` 共用）。格子小于 1 倍时平滑缩小，不再用 `pixelated` 把像素丢掉；第 6–9 世代的贴图本来就是抗锯齿的渲染图，平滑缩放。原来所有 `.px-art` 一律 `pixelated`，抗锯齿图在非整数倍下会出锯齿，现在只有整数倍的像素图才加 `px-art-pixel`。
- 统一的尺寸：地图棋子保持像素贴图；列表行 32px；面板头像 64px（像素画风，DPR 1 / 2 下都是 1× / 2×）；对战卡 40px（DPR 2 下按 32px ×1 居中）。
- **绘卷的大头像，两种方案对比**（`sprites/`）：
  - A：像素贴图整数倍放进画框圆章（`sprite-option-a-pixel-unit-panel.png`）。92px 的圆章里只有 ×2（64px，宝可梦本身只占约 40px，显得很小）或 ×3（96px，比圆章大，被裁边）两种选择；而且第 6–9 世代本来就是另一种画法（抗锯齿渲染图），同一个面板里画风不统一。
  - B：同一仓库（PokeAPI/sprites，同一提交）的官方插画 `other/official-artwork`（`sprite-option-b-artwork-unit-panel.png`）。
  - 对照表 `sprites/sprite-options-sheet.png`：13 个物种（第 1–9 世代）分别是 A ×2、A ×3、B。
  - **采用 B**，只在绘卷画风下生效：插画与绘卷的平滑描边、圆章、衬线标题是同一种语言；所有世代画风一致；可以按 84px 任意缩放而不出锯齿。地图棋子与像素画风不变。
- 资源：`public/sprites/art/<全国图鉴号>.webp`，115 个物种（`src/browser/sprites.ts` 的 `POKEDEX` 全覆盖，`tests/core/fidelity-art.test.ts` 校验）。原图 475 × 475 PNG 先下载到单独的空目录、逐个确认是 PNG，再用 Chromium 画布的高质量重采样两步缩到 192 × 192（84px 头像在 DPR 2 下的 168px 再留余量）、存成 WebP（质量 0.88），整个目录约 1.0 MB，按需加载，不进 JS 包。来源、提交、路径、处理方式与原图校验和记录在 `public/sprites/art/manifest.json`，与 `public/sprites/gen*/manifest.json` 同一格式（`docs/design/roster-v14.md` §4）。
- 用到的地方：单位面板头像（绘卷 84px 插画）、阵容选择（绘卷 40px）、挑战 / 道馆对战卡（40px，绘卷下放在米色圆盘上）；传说奇观卡、落成卡、世代献礼卡的像素贴图按整数倍绘制。

## 4. 细节

- **顶栏**：七种精华改成固定的 4 × 2 网格（原来在 1280 宽时被挤成一列，顶栏高到约 140px；在另一些宽度又从右边被裁掉）；1260px 以下把每轮增量移进提示（`· 每轮 +N`）。“球”按钮不再继承 `.resource` 给图标留的 25 / 38px 左边距，左右对称。启动器按钮最小宽度 50 → 46px。现在 1200–1920 宽度顶栏都是一行、72px（绘卷）/ 62px（像素）。
- **城市面板**：生产页签 6 个一行在 12px 下会把“训练宝可梦 / 训练开拓队”截断，改成 3 × 2；城市导航的 5 个页签列宽至少等于文字宽度（“人口与地块”不再贴边），页签字重 500、高 32px。
- **开局目标卡**：宽 248 → 264px，加 `text-wrap: pretty`，不再出现单字成行。
- **绘卷**：世界页“下一步”卡片、单位面板的进化框、对战卡头像原来还是像素画风的青绿底，改成胡桃木 / 黄铜 / 米色圆盘；单位面板头像去掉强制的 80px 尺寸（2.5 倍，像素宽窄不一）。
- 被强制尺寸的图片规则去掉了：`.unit-portrait img`（含手机端 58px）、`.cp-sprite img`、`.dedication-art img`、`.legend-card img`、`.legend-arrival-card img`、`.route-step .locate-btn img`；尺寸由标记决定，CSS 不再二次缩放。
- 按键提示 `kbd` 改用界面字体（原来是等宽字体，“空格”会回退到另一种字体）。
- 地图上的文字（城市旗标、单位角标、地形符号）改用同一套字体角色，详见 §5。

## 5. 地图贴图

截图：`map/<画风>-<场景>-z<缩放>-before|after.png`（森林边缘、山脉、海岸、城镇；缩放 1.5 与 4；绘卷与平面；DPR 2；第 61 轮的 AI 存档）。

- **绘卷**（`render/painted/terrain.ts`，全部是代码画的原创图形，按尺寸烘焙进缓存）：
  - 阔叶树：5–7 个重叠的树冠瓣、深色描边、右下暗面、左上高光与叶纹；树干上细下粗带根部；每棵树都有柔和的落地阴影。
  - 针叶树：分层的扇贝边树层、左侧受光；雪原上积雪落在受光一侧。
  - 森林：约 9 棵一簇，后高前低，前面加灌木；四种变体（两种阔叶林、松林、混交林）。荒漠绿洲有小水塘和两棵棕榈。
  - 山脉：描边、西坡亮东坡暗、冲沟、山脊高光、带暗面的雪顶，部分变体有碎石与松树。丘陵、巨石、仙人掌、火山锥用同样的描边与明暗处理。
  - 清晰度：烘焙图原来会被放大最多 9%（发虚），现在先按大一档烘焙，只做缩小（最多 8%）。
- **平面 / 2.5D**：`drawPixelArt`（`render/terrain25d.ts`）让每个像素在屏幕上大小一致——接近整数倍时按设备像素对齐的最近邻绘制；在两个整数倍之间先放大到下一个整数倍再平滑缩小；小于 1 倍时取平均而不是丢行。地块尺寸不变，物件、城镇和宝可梦棋子最多移动 20% 以落在整数倍上。平面城市里的 SVG 建筑改为平滑绘制。
- **地图文字**：城市旗标、单位角标、地形符号使用 `FONT_UI` / `FONT_DISPLAY`；城市名在任何缩放下不小于 12 CSS px，单字角标不小于 9–11px。
- 性能：仍是每个尺寸烘焙一次并缓存；像素画风每件图最多缓存三个放大副本；`performance.spec.ts` 通过。
- 没有重画的：海岸线（只是缩放更清晰）；农田、设施区、改良的图标仍是像素图，本来就按整数倍绘制。

## 6. 检查

- `npm run check:plan`：smoke `skip`（没有改动进入 `tools/district-smoke.ts`、`src/core/step.ts`、`src/core/game.ts` 的运行时导入闭包）；`src/browser/main.ts` 改了提示文字，所以浏览器 spec 全跑；CSS / 布局改动触发生产构建 e2e。
- 新增 `tests/core/fidelity-art.test.ts`：整数倍尺寸计算、头像标记、插画清单与文件逐字节校验。`districts.spec.ts` 改为断言 12px 下限。
- `E2E_PORT=4281 npm run check`：tsc ×2、eslint、vitest、vite build 通过，Playwright 234 通过 / 3 跳过（唯一失败是 `districts.spec.ts` 仍断言旧的 10px，改后 7/7 通过），`npm run test:e2e:prod` 2/2，smoke 跳过。
- DOM 审计（1280，绘卷，含中文且小于 12px 或任意文字小于 11px 的元素数）：城市视图 87 → 3、单位视图 102 → 2、研究 136 → 4、世界页 201 → 9；剩下的都是 11px 的标签（文明徽章、“文明 6”提示签、移动点、按键提示、研究线标签）。1280 / 1440 / 1920 / 390 宽度下没有被截断的文字（只剩读屏专用的隐藏标签和一个 5 字图鉴名的省略号）。
- 包体：JS 约 +30 KB（未压缩，约 +2%，主要是矢量图标），CSS 约 +2 KB；`public/sprites/art` 约 1.0 MB，只在绘卷的大头像里按需加载。
- 为了不让测试计划把新模块当成“未映射”而全量运行、也不去改 `tools/test-plan-map.ts`（会触发 FULL GATE），这次没有新增 `src/browser` 模块：字体常量放在 `theme.ts`，整数倍尺寸放在 `ui-icons.ts`。
