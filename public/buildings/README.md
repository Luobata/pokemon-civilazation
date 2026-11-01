# 建筑像素素材

六张 96×80 SVG 均为本项目手写原创，使用整数坐标和 `shape-rendering="crispEdges"` 呈现 GBA 式硬边像素轮廓，运行时不依赖外部图片、字体或 CDN。

- `headquarters.svg`：联盟总部
- `pasture.svg`：树果园
- `workshop.svg`：精灵球工坊
- `meetingHall.svg`：友好商店
- `observatory.svg`：宝可梦研究所
- `trainingGround.svg`：宝可梦中心

文件名沿用既有 `BuildingId`，不代表新增或修改游戏规则。地图上的通用宝可梦小镇由 `src/browser/canvas.ts` 直接绘制，只使用公开城市信息；精灵球镇牌不表示该城已经建成宝可梦中心。
