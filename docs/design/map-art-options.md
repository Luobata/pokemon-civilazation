# 地图贴图方案对比（绘卷画风）

2026-11-20 · 用户反馈：程序化绘制的树木和山“还是比较粗糙”，并问有没有可以非商业使用的开源素材库。本文把四条路线放进**同一个存档、同一组镜头**里比较，给出推荐。本阶段只做对比，不集成第三方素材。

- 镜头：`?theme=painted`，DPR 2，1280 × 900；第 61 轮的 AI 存档（种子 31，与 `docs/design/fidelity/map/` 同一份存档）；森林边缘、山脉、海岸、城镇四个场景，各取缩放 1.5 与最大缩放 4，外加一张整页（缩放 1.2，城市面板打开）。四个场景都选在玩家当前可见的格子上（不是迷雾里的墨线图）。
- 每张对比图是 2 × 2：左上现状（程序化绘制，基线）、右上 A、左下 B、右下 C。对比图在 `docs/design/map-art-options/`，原始截图缩到 75% 存为 JPEG；A 的最大缩放原尺寸截图另存为 PNG。
- **只替换了竖立物件、海岸边与城镇**（树、林、丘陵、山、峰、海岸、城镇）。地面底图、河流、边界丝带、迷雾、单位徽章、产出硬币、城市横幅四个方案完全相同，所以差别都来自物件本身。某个方案没有覆盖的物件（如沙漠、雪原、B / C 的海岸与丘陵）退回现有的程序化绘制。
- 第三方素材只放在 `/tmp/map-art/<名字>/`，通过一个不进仓库的开发覆盖（`/tmp/map-art-tools/thirdparty.ts`，Vite `/@fs/` 读取）装进渲染器；仓库里没有任何第三方图片。截图里出现的第三方美术仅用于本设计对比，来源见每张图的标注与下表。

## 对比图

| 场景 | 缩放 1.5 | 缩放 4（最大） |
| --- | --- | --- |
| 森林边缘 | `map-art-options/compare-forest-z1.5.jpg` | `map-art-options/compare-forest-z4.jpg` |
| 山脉 | `map-art-options/compare-mountain-z1.5.jpg` | `map-art-options/compare-mountain-z4.jpg` |
| 海岸 | `map-art-options/compare-coast-z1.5.jpg` | `map-art-options/compare-coast-z4.jpg` |
| 城镇 | `map-art-options/compare-town-z1.5.jpg` | `map-art-options/compare-town-z4.jpg` |
| 整页（中期局面） | `map-art-options/compare-full.jpg` | |

A 的原尺寸截图：`map-art-options/a-<forest|mountain|coast|town>-z4.png`；A 的素材总表：`map-art-options/a-asset-sheet.png`。

截图中的第三方美术来源：B 为 Kenney Nature Kit 2.1（`Isometric/*_SE.png` 渲染图）与 Kenney Hexagon Pack（`PNG/Objects/` 房屋、教堂、塔），作者 Kenney Vleugels / kenney.nl，CC0；C 为 Battle for Wesnoth `data/core/images/terrain/`（forest、hills、mountains、village 下的若干 PNG，master 分支，2026-11-20 下载），Battle for Wesnoth 项目，GPL-2.0+ 或 CC BY-SA 4.0（见下文）。

---

## A. 原创矢量插画（本项目手绘 SVG）

| 项目 | 内容 |
| --- | --- |
| 外观 | 故事书 / 桌游插画风：统一的深墨描边（与绘卷图标、徽章同一种墨色 `#2B1E10`）、西北受光、平涂加两三层明暗、少量高光笔触。阔叶树是带叶瓣的圆冠，冷杉是三层下垂枝的塔形；树林有一块暗色林下地面把十几棵树“捏”成一片林子；山是带棱面的岩体加锯齿雪顶，后排山做了空气透视（更浅、更灰）；城镇是七座山墙小屋加一座带尖塔的议事厅，部分屋顶与塔尖取阵营色；海岸是一条沙滩 + 湿沙 + 扇贝形浪花的边带。截图：所有 `compare-*.jpg` 右上，`a-*-z4.png`，`a-asset-sheet.png` |
| 与绘卷界面的协调 | 最好。墨线粗细、暖色、圆润造型和胡桃木 / 黄铜边框、米色徽章、衬线城名是一套语言；最大缩放下仍是清晰矢量（按设备像素栅格化，没有放大模糊）。和宝可梦官方插画头像同属“干净描边 + 平涂明暗”的路子，放在一起不打架 |
| 不足（逐张看过） | 1. 缩放 1.5 时阔叶林偏密偏暗，整页看森林是最重的一块颜色，后续要把林下暗面减一档、树冠留一点缝。2. 城镇在缩放 1.5 下房子很小、细节偏碎，阵营色只落在 3 个屋顶和塔尖上，辨识度不如现状的大房子；需要按人口做 3 档（小村 3–4 座、城镇、带城墙的大城），小档的房子要更大。3. 山体的明暗面分界偏硬，岩色偏暖褐，在暖色地面上不够跳；可加冷灰的远山和更亮的雪线。4. 海岸浪花线在凹海岸的转角处有一点重叠变亮；雪原、火山、山地海岸还退回程序化。5. 冷杉稍细 |
| 许可与义务 | 全部是本项目新画的，不含任何第三方素材，可直接提交（本次已提交）。注意：`public/buildings/README.md` 只写明“本项目手写原创”，仓库根目录没有统一的许可证文件；A 的素材与 `public/buildings/` 同等地位，正式发布时与项目整体许可一起声明即可 |
| 覆盖全部生物群系与物件的工作量 | 本次已画：阔叶树、冷杉、阔叶林 / 松林 / 混交林三种林、草地丘陵、山脉、高峰、沙质海岸、一档城镇（10 个 SVG，共约 54 KB）。还要画：每个群系再 1–2 个树种与变体（雪原冷杉、沙漠棕榈与仙人掌、绿洲、灌木）、沙漠 / 雪原丘陵、雪原与沙漠山脉、火山、礁石、雪 / 火山 / 岩石海岸、城镇 3 档 + 首都城墙 + 奇观塔、地标石碑。按本次速度估计约 25–35 个 SVG、2–3 个工作日（含逐张在 1.5 / 4 倍下校对）；用 `<symbol>` 复用树、房子后，新增变体主要是摆位 |
| 性能 | 运行时开销与现状同级：SVG 只在加载时解码一次（10 张 + 城镇每个阵营色一张，`?mapart=svg` 时按需加载，不进主 JS 包），之后按尺寸档位栅格化进现有缓存。Chromium 实测，烘焙全部林 / 丘 / 山物件：R=68 设备像素 9 ms、R=182 为 14 ms（现状程序化 12 / 24 ms）；4 个阵营色城镇 4–5 ms（现状 3–6 ms）。地形块缓存、按块重建的逻辑不变 |
| 接入方式（已实现，开发开关） | `src/browser/render/painted/map-art.ts` 提供一个默认关闭的替换接口（物件、城镇、海岸边各一个钩子，返回 `undefined` 时退回程序化）；`?mapart=svg` 时动态加载 `map-art-svg.ts` 与 `public/map-art/painted/*.svg`。不带参数时渲染结果与现状一致 |

## B. Kenney（CC0）

| 项目 | 内容 |
| --- | --- |
| 用到的包 | Kenney Nature Kit 2.1（3D 低多边形模型，包里自带每个模型四个方向的 512 × 512 等距渲染图 `Isometric/`）：树 `tree_oak` / `tree_default` / `tree_detailed` / `tree_pineTallA_detailed` / `tree_pineRoundD`、岩石 `rock_tallB` / `rock_tallE` / `rock_largeA`；Kenney Hexagon Pack：城镇用 `PNG/Objects/house.png`、`house_small.png`、`church.png`、`tower.png`。Hexagon Pack 自带的树（`treeRound_large.png` 只有 20 × 46）太小，没有采用 |
| 外观 | 干净的低多边形渲染，原包配色是青绿树冠 + 橙色树干 / 岩石（包里的 `Preview.png` 就是这套配色，不是渲染出错）。截图：所有 `compare-*.jpg` 左下 |
| 与绘卷界面的协调 | 差。青绿 + 橙的配色和胡桃木 / 羊皮纸 / 暖绿地面冲突，整页里一眼就是“另一款游戏”；没有墨线描边，和徽章、图标的语言不同；包里没有山（只能用岩柱拼，读起来像红岩峡谷），也没有丘陵和海岸。Hexagon Pack 的房屋是 88 × 70 的小图，最大缩放下明显发虚，而且是现代 / 西部风格的平顶小楼 |
| 许可（读自包内 `License.txt`） | Hexagon Pack：“License (Creative Commons Zero, CC0) … You may use these textures/photographs in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory.” Nature Kit 2.1：“License: (Creative Commons Zero, CC0) … This content is free to use in personal, educational and commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)” |
| 义务 | 无署名义务、无相同方式共享；可以随仓库再分发、修改、重新上色。建议（非强制）随素材保留 `License.txt` 并在致谢里写 Kenney / kenney.nl |
| 覆盖全部物件的工作量 | 要和绘卷一致，必须从 `Models/GLTF format` 重新渲染：换成自己的材质配色、加描边（后处理或反向外壳）、固定 37° 俯角与西北光，再导出每个尺寸档位的图。这需要搭一条 3D 渲染管线（Blender 或 three.js 离线渲染），约 2–4 天；山、丘陵、海岸、城镇仍要另找或自己做 |
| 性能 | 用 512 × 512 渲染图缩小，烘焙 4–12 ms；运行时与现状同级。需要预加载约 12 张 PNG（每张 5–20 KB）；若重新渲染成多档位图集，体积会到几百 KB |
| 结论 | 许可最干净，但“直接用”风格不合；要合就得重渲染，工作量不比 A 小，且山 / 丘 / 海岸 / 城镇仍缺 |

## C. Battle for Wesnoth 地形

| 项目 | 内容 |
| --- | --- |
| 用到的文件 | `forest/deciduous-summer.png`、`deciduous-summer2.png`、`pine.png`、`mixed-summer.png`、`deciduous-summer-sparse.png`（144 × 144），`hills/regular.png`（72 × 72，整格地面），`mountains/basic.png`、`basic2.png`、`peak.png`（180 × 216），`village/human-city.png`、`human.png`、`human-city2.png`（72 × 96） |
| 外观 | 写实偏厚涂的俯视地形画：树冠是密集的叶团，山是带岩纹的写实山体，村庄是 3/4 视角的石墙红瓦房。截图：所有 `compare-*.jpg` 右下 |
| 与绘卷界面的协调 | 差。1. 分辨率：Wesnoth 一格只有 72 px 宽，我们的格子在缩放 1.5 / DPR 2 时约 114 设备像素、缩放 4 时约 305 设备像素，要放大 1.6–4.2 倍，最大缩放下整片发糊（见 `compare-forest-z4.jpg` 右下）。2. 投影：Wesnoth 是平顶六边形、正俯视，物件图自带一块按它的格子裁好的地面，放在我们的尖顶倾斜六边形上会露出六边形的切边和不同色的地皮（丘陵、山脉最明显）。3. 画风：写实厚涂、无描边、偏冷偏暗，和绘卷的墨线平涂、圆章、宝可梦官方插画都不是一路，城镇只有一张房子的图，放大后成了一座巨大的单体建筑。4. 没有阵营色、没有夜间窗灯 |
| 许可（读自下载的文件） | `copyright`：“Copyright (C) 2003 - 2018 by David White … free software; you can redistribute it and/or modify it under the terms of the GNU General Public License version 2 or at your option any later version.” `COPYING`：GPL v2 全文。`README.md`：“All source code is licensed under the GNU GPL v2+. Most art and music is also licensed under the GNU GPL v2+, however new contributions are now licensed under the Creative Commons BY-SA v4.0.” wiki `Wesnoth:Copyrights`（README 指向的权威页面）：“All visual and audio assets are licensed under either the GNU GPL v2 or later, or the Creative Commons BY-SA 4.0 … all future contributions will be under the CC BY-SA 4.0 license unless they are specifically noted to instead be under the GNU GPL v2 or later.” 仓库里的逐文件清单 `copyrights.csv` 只登记了音乐和音效（396 行全部是 `sounds/`、`music/`），**没有任何图片的逐文件许可或作者** |
| 义务 | GPL-2.0+ 的图：随分发附 GPL 全文，提供“修改用的首选形式”（Wesnoth 解释为作者提交的那份文件），修改后的版本也必须是 GPL；CC BY-SA 4.0 的图：署名（作者名、许可、链接、是否修改），修改后的版本以 BY-SA 4.0 发布。两种都是相同方式共享，混进本仓库要单独划出目录、单独声明，不能并入项目自己的原创素材 |
| 能否随仓库再分发 | 许可本身允许，但**逐文件的许可与作者无法从官方文件确定**（2017-07-30 之后的贡献默认是 BY-SA，需要作者署名，而 `copyrights.csv` 不覆盖图片），要逐张翻提交记录才能写对署名，而且两种相同方式共享许可会让地图素材长期与项目其它素材分开管理。按任务要求“许可不清就放弃”：**放弃 C 作为集成方案**，截图仅作对比 |
| 覆盖全部物件的工作量 | 素材本身很全（各季节森林、雪林、热带、沙漠山、火山、各种村庄），但要重新做透明底、转成尖顶六边形构图、补阵营色和夜灯，且分辨率不够最大缩放用，等于重画 |
| 性能 | 小图，烘焙 9–44 ms（R=182 时丘陵要做羽化遮罩，最慢）；运行时与现状同级 |

## D. 另一个候选：评估后放弃

| 候选 | 许可（来源） | 放弃原因 |
| --- | --- | --- |
| Screaming Brain Studios《160+ Toon Style Hex Tiles》（OpenGameArt） | CC0（OpenGameArt 页面的许可字段；只下载了预览图，没有下载压缩包） | 是纯色六边形地块（预览 `demo_1_13.png`），没有树、山、城镇等竖立物件，解决不了用户的问题 |
| Robert Ramsay《Hand Painted Trees》（OpenGameArt） | CC-BY 4.0（页面字段；只下载了两张预览） | 侧视的写实大树（800 px 级、枝叶细碎），缩到地图上 30–60 px 只剩一团噪点，也没有山和城镇 |
| adythewolf《Hex Tileset Pack》、Beast《Worldmap/Overworld tileset》、Phlosioneer《Hex Coastline》（OpenGameArt） | CC0 / CC-BY 3.0 / CC-BY-SA 3.0（页面字段） | 16–32 px 像素画，属于平面像素画风，不适合绘卷 |
| Quaternius 低多边形自然包 | CC0（未下载） | 与 B 的 Kenney Nature Kit 是同一类低多边形 3D 模型，同样需要自建 3D 渲染管线并重新配色，结论与 B 相同，不再重复做一遍 |

这些都没有进入截图对比；上表的许可只读了 OpenGameArt 页面上的许可字段，没有下载各包、也没有读包内的许可文件，因此不能作为集成依据。

---

## 推荐

**采用 A（原创矢量插画），继续把它画全，再把开发开关改成绘卷的默认物件。**

- 画风：四个方案里只有 A 与绘卷的界面（墨线、暖色、黄铜圆章、羊皮纸迷雾）和宝可梦官方插画头像是同一种语言；最大缩放下也是清晰矢量。B、C 无论许可多宽松，“直接用”都会把地图变成另一款游戏，改到协调需要的工作量不比 A 少。
- 许可：A 没有任何第三方义务；B 虽然是 CC0 但要重渲染；C 有相同方式共享义务且图片的逐文件许可与作者无法确定，已放弃。
- 工作量：本次的 10 个 SVG 已经证明管线可行（接入只是三个钩子，缓存、分块、迷雾都不用改），剩下的是画图。建议顺序：先修本次看到的问题（阔叶林减暗、城镇按人口分 3 档并放大房子、山色加冷灰与更亮的雪线、海岸转角），再补雪原 / 沙漠 / 火山与其余海岸，最后补奇观塔、首都城墙与地标。
- 可以保留 B 的一点：如果以后需要大量“道具类”小物件（木桩、篝火、栅栏），Kenney 的 CC0 模型可以作为造型参考或重渲染来源，没有许可负担。

## 复现

- A：`npm run dev` 后打开 `/?theme=painted&mapart=svg`（素材在 `public/map-art/painted/`，代码在 `src/browser/render/painted/map-art.ts`、`map-art-svg.ts`）。
- B / C：第三方素材与脚本只在本机 `/tmp/map-art/`（`kenney-hexagon/`、`kenney-nature/`、`wesnoth/`，另有 `sbs-toon-hex/`、`oga-painted-trees/` 两个只含预览图的目录）和 `/tmp/map-art-tools/`（`thirdparty.ts` 开发覆盖、`vite.shots.mjs` 截图用 Vite 配置、`shot.mjs` 截图、`sheet.mjs` 拼图、`perf.mjs` 烘焙计时、`gen-svg.py` 生成 A 的 SVG 外壳）。仓库里不包含它们。
