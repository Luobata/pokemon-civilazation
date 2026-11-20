# 建筑像素素材

六张 96×80 SVG 均为本项目手写原创，使用整数坐标和 `shape-rendering="crispEdges"` 呈现 GBA 式硬边像素轮廓，运行时不依赖外部图片、字体或 CDN。

- `headquarters.svg`：联盟总部
- `pasture.svg`：树果园
- `workshop.svg`：精灵球工坊
- `meetingHall.svg`：友好商店
- `observatory.svg`：宝可梦研究所
- `trainingGround.svg`：宝可梦中心

许可：本项目原创素材，不含第三方来源；许可待仓库所有者决定（仓库目前没有 LICENSE 文件，`docs/` 与提交历史中也没有为本项目原创素材声明过许可）。与 `public/map-art/` 的地图素材同等地位，见 `public/map-art/README.md`。

文件名沿用既有 `BuildingId`，不代表新增或修改游戏规则。地图上的通用宝可梦小镇由 `src/browser/canvas.ts` 直接绘制，只使用公开城市信息；精灵球镇牌不表示该城已经建成宝可梦中心。
