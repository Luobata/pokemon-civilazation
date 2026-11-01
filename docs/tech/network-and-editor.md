# 本地多人服务与内容编辑器

## 运行形态

本地多人采用权威服务器加瘦浏览器客户端：

```bash
npm run server            # 默认 http://127.0.0.1:8787
npm run dev               # Vite 页面，默认 http://127.0.0.1:5173
```

多人页面默认 API 地址为 `http://127.0.0.1:8787`。房间邀请链接指向当前 Vite 页面，并在 URL fragment 中携带 `api`、房间、座位与令牌；fragment 不会随常规 HTTP 请求发送到页面服务器。若部署在同源反向代理后，可将 API 地址改为页面同源。

服务器不会自动执行 AI 回合。只有当前 `activePlayerId` 对应的座位能提交命令；人类玩家轮到谁，谁的客户端提交。

## 房间与令牌

1. `POST /api/rooms` 校验 2–4 人类座位、地图和轮数上限，创建 expansion v1 权威状态。
2. 响应返回 128-bit `roomId`、256-bit `ownerToken`，以及每个座位一次性 256-bit `joinToken`。
3. `POST /api/rooms/{roomId}/join` 必须携带正确座位的一次性 join token。入座成功后 join token 作废，并签发长期 seat token；重复消费返回 409。
4. 座位后续请求使用 `Authorization: Bearer <seatToken>`。服务器从内存中的座位令牌反查 actor，客户端不能自报座位。
5. 房主 token 只用于邀请重发、保存、读取、导出和关闭房间；它不能替代座位 token 提交玩家命令。

空闲房间默认 6 小时后释放内存；持久化文件不会被 TTL 删除，只有 owner close 会清理该房间的存档。

## 命令与视图

`POST /api/rooms/{roomId}/commands` 请求体只允许 `expectedSeq` 与 `action`：

- `expectedSeq` 小于权威序列返回 `stale-command`；
- 大于权威序列返回 `future-command`；
- action 先经审计/扩展 canonical parser，输入与净化结果不一致或带额外字段即拒绝；
- 再交给核心 `step` 原子执行。

解析器使用房间的实际内容包校验物种等枚举，扩展物种不会被经典 39 种表误拒。入座、玩家命令和房主管理操作按房间串行执行，读档期间到达的命令在读档完成后验证序号，避免磁盘读取覆盖已接受的命令。

成功或失败响应都返回该座位的 `PlayerView`。`GET /api/rooms/{roomId}/state` 同样只返回迷雾投影，不暴露 `GameState`、RNG、`nextEntityId`、私有玩家经济或其他座位手牌式信息。核心 `observe` 是唯一投影入口。

## 存档

启用 `POKEMON_SAVE_DIR` 后，房主可用 `slot-1` 到 `slot-10`：

- `POST /owner/save` 写入 0600 权限的房间前缀文件；
- `GET /owner/saves` 列出可读取摘要；
- `POST /owner/load` 校验 format/schema/rules/content/setup、状态与命令日志一致后，从命令日志完整重放；
- `POST /owner/export` 仅房主可导出完整存档；
- 请求体上限 1 MiB，单档上限 10 MiB，全局最多保留 20 个房间身份的存档并按 mtime 淘汰。

写入方篡改状态或命令日志都会在重放比对时被拒绝。

## 内容编辑器

`editor.html` 以 `EXPANSION_CONTENT`（版本 `expansion-v1`）为基线深拷贝。编辑器只接受声明式 JSON，不执行内容中的代码，且必须通过：

- 固定 section 与 ID 集合；
- 字符串、整数、枚举、布尔、数组去重和边界；
- 物种阶段预算与训练成本公式；
- 47 物种 full18、researched weakness、双属性相乘后的全对全 D15（同阶段单击不超过最大 HP 60%）；
- 建筑与科技/精灵球引用、单位地形与物种投影一致性、平衡树形状与移动成本。

校验通过后，页面在真实 `createGame`/`step`/`observe` 沙箱中执行命令。导入失败不会替换当前沙箱；导出前会再次校验。所有修改只影响沙箱，不写入共享 `EXPANSION_CONTENT`。

当前编辑器允许修改固定 ID 的定义，不支持新增物种、科技或行动类型。扩展战斗的免疫取自完整属性表；JSON 中保留的 `immunities` 字段仅用于经典规则，扩展模式修改它不会覆盖属性表。
