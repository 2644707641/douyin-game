# 调查发现与决策

## 用户需求
- 同一账号在设备 A 登录并产生进度后，设备 B 登录应同步相同进度。
- 修复应兼容当前静态站点部署方式与现有本地存档。
- 仅账号名为 `xuwang` 的登录用户可以看到并使用“提升一颗星”测试功能。
- 每次使用后用户段位增加一颗星，功能用于页面测试。
- 实现后重新启动本地项目。

## 已知约束
- 仓库没有源码构建链，主要手写逻辑位于 `web-platform-patch.js`。
- `bundle.js` 与 `index.js` 是编译产物，只允许必要的外科式修改。
- 当前 `web-platform-patch.js` 存在未提交改动，必须保留。
- 最近提交包含自定义账号鉴权与 Supabase 云存档实现，属于高相关调查范围。

## 调查发现
- 最近提交 `2fafe3f` 将 Supabase Auth 改为自定义账号 RPC，并大幅重写云存档鉴权。
- 当前未提交改动在登录/注册后传入 `reloadPage: true`，并在手动恢复后调用页面重载；这表明已有尝试在解决“存档数据已恢复但运行中的 Laya 游戏未重新读取”的时序问题。
- 当前差异仅显示新增重载调用，尚不能证明云端读写本身成功；需要继续区分“没下载到云存档”和“已下载但游戏内存状态未刷新”。
- 首次宽泛 CodeGraph 查询误命中大量 `Web*` 图形引擎符号，下一步改用精确函数名查询。
- `createCloudSaveController.init()` 先按当前 URL 的 `saveId/saveToken` 拉取存档、合并本机旧存档，再安装 `Laya.LocalStorage` 覆盖层。
- `accountController.restoreBoundSave()` 能根据账号表中的 `save_id/save_token` 拉取绑定存档，并替换控制器内的 `storageMap`、镜像到原生 `localStorage`、更新当前 URL；但它本身不会让已启动的游戏对象重新读取进度。
- `afterSignedIn` 在账号登录阶段调用恢复，而登录发生时游戏通常已经完成初始化，因此“恢复成功但画面/内存仍是本机旧进度”是强候选根因。
- 云恢复会设置 `lastSyncedSerialized` 为远端原始数据；若不合并当前存档则不会反向覆盖远端，设计上不会因为单次恢复立即把设备 B 的旧进度写回设备 A 存档。
- 当前未提交修改确实让注册/登录和手动恢复在成功后触发页面重载；重载目标 URL 已被 `restoreBoundSave` 更新为账号绑定的 `saveId/saveToken`。
- `index.html` 当前不再直接加载 `bundle.js/index.js`，而是加载 `game-bootstrap.js`；需要确认该引导脚本是否等待 `patchState.ready`，这会决定“刷新后先恢复、再启动游戏”是否成立。
- `patchState.ready` 的顺序为：当前 URL 云存档初始化完成后，再恢复本地账号会话并尝试账号绑定存档。若引导脚本等待该 Promise，已登录设备刷新时理论上能在游戏启动前装入账号存档。
- `game-bootstrap.js` 明确等待 `window.__LayaWebPlatformPatch.ready` 完成后才加载 `bundle.js` 和 `index.js`，因此刷新后能够在游戏读取 `playerData` 前完成账号云存档恢复。
- 已确认直接代码错误：登录调用方传入 `{ reloadPage: true }`，但 `afterSignedIn()` 不接收参数且丢弃恢复结果，所以页面运行期间登录不会刷新。
- Laya 游戏启动时把 `playerData` 读入内存，后续继续从旧内存对象写回；只替换存储层而不刷新，既不会立刻显示远端进度，还可能用设备 B 的旧内存状态反向覆盖远端进度。
- 账号同步另有行为缺口：未绑定账号登录时不会自动调用 `bindCurrentSave`，所以仅在设备 A、B 登录同一账号并不足以建立进度关联，仍需手动绑定。这与用户“登录即同步”的预期不一致。
- 本地页面验证显示补丁、游戏引导、`bundle.js`、`index.js` 均按顺序加载，`Laya.stage` 已创建，账号面板正常显示。
- 浏览器中 `patchState.getStatus()` 返回有效的新存档身份和默认资料；控制台错误列表为空。
- 未使用真实账号执行生产 Supabase 注册/登录，避免未经确认调用生产写 API；跨设备语义由隔离的 Node 行为测试覆盖。
- 账号身份可从 `state.session.user.account` 获取，适合做严格账号名判断。
- 账号面板已有集中式 `updatePanelState()`，适合统一控制测试按钮的隐藏和禁用状态。
- 宽泛的段位 CodeGraph 查询命中 Laya 核心噪音，已改为等待精确调用链调查结果。
- 即使查询 `_curStar` 精确字段，CodeGraph 仍误匹配 Laya 图形层的通用 `setData/cur` 符号；按项目规则已先使用 CodeGraph，后续可退回 `rg` 做编译产物的精确字符串定位。
- 授权显示方案可以完全放在现有账号面板中，不需要改动 `bundle.js` 的 UI。
- 精确定位确认 `_curStar` 是当前总星数，`curStar` setter 会触发 `setData()`；但游戏内部 `Pn/gn/F` 均位于 bundle 闭包，web 补丁无法直接安全调用。
- 采用已确认的存储方案：解析现有 `playerData`，仅修改 `_curStar` 与 `_saveTime`，通过已接管的 `Laya.LocalStorage.setItem` 触发云存档，再强制 flush 并刷新页面。
- `_lastStar` 用于每日段位奖励比较，不应随测试升星修改。
- 授权账号必须精确匹配 `state.session.user.account === "xuwang"`；SQL 与当前会话均区分大小写。
- `superpowers` 引用的后续参考文件/目录当前不可访问，将依据已读取主 Skill 的流程摘要继续。
- 规格审查发现并已修复：星级必须为非负整数；强制 flush 必须等待已有写入后再次上传最新数据；非授权操作需要直接无副作用测试。
- `flushNow()` 现在在存在 `writeInFlight` 时等待其结束，再根据最新 `storageMap` 重新执行本次 flush，避免把旧请求误当作升星上传成功。
- 本地浏览器验证：未登录状态下测试区节点存在但 `hidden=true`，按钮 `disabled=true`，交互树中不可见；Laya 舞台正常且浏览器错误列表为空。
- 用户实测反馈原存储方案点击后段位无变化。根因是只更新云存档映射，没有更新 bundle 闭包中的玩家单例和段位管理器，旧内存状态可继续覆盖存储。
- 修复改为在 `bundle.js` 内做外科式测试桥：调用正常胜利使用的 `Pn.instance().zG(1)`，随后 `jG()` 失效排行榜缓存并调用主场景 `RV()` 即时刷新。
- 测试桥同时提供 `restoreRankStar()`，云上传或资料同步失败时可恢复运行时星级并再次 flush。
- 为避免浏览器继续缓存旧 bundle，`index.html`、`game-bootstrap.js`、`web-platform-patch.js`、`bundle.js` 和 `index.js` 使用统一版本 `star-runtime-20260713`。
- 浏览器最终验证确认 `bridgeReady=true`，所有相关脚本均加载新版本，错误列表为空。
- 用户要求把商人恢复为 Git 最早版本的段位解锁机制。
- 初始版本的 `Px()` 条件为 `rank.ca.id >= this.Ue.Re` 才把 `player.openProps` 设为 true。
- `8738f25` 明确删除了段位条件，改为无条件 `openProps = true`；`e681ac8` 后来只恢复了条件判断。
- `3f9e06e` 又让主场景只要旧存档中的 `openProps=true` 就直接显示商店按钮；因此曾经过无条件解锁版本的存档会永久残留 true，即使当前段位不足也仍显示商人。
- 最早版本的 `openProps` 默认值为 false，阈值配置 `props.Re` 为段位 ID 1。
- 最早版本达到阈值后会在战斗结算返回主界面时自动打开一次商店；商店关闭后通过事件把小毛驴入口显示出来。
- 后续 `9a6cb51` 删除了结算后自动打开商店，`3f9e06e` 改为主场景直接显示入口；当前代码仍是这一组合。
- 当前提前出现的直接原因不是 `Px()` 条件缺失，而是旧存档已经持久化 `_openProps=true`，当前条件只会设 true、从不会在未达段位时纠正为 false。
- 已恢复三段联动机制：`Px()` 按当前段位纠正 `openProps`；结算返回主界面时首次自动打开商店；主场景加载不再直接常驻显示商人入口。
- 低段位旧存档会被纠正为 `openProps=false`。这比最早版本的永久解锁更严格，但符合用户“未达到指定段位不应出现”的明确要求，并修复历史污染。
- 浏览器以新存档、军士一段位进入主界面，截图确认没有商人/商店入口；脚本已加载 `merchant-rank-20260713` 版本且无控制台错误。

## 技术决策

| 决策 | 原因 |
|------|------|
| 优先使用 CodeGraph 定位调用链 | 仓库存在 `.codegraph/`，项目规范要求先于 grep/find 使用 |
| 仅在成功恢复绑定存档后重载 | 避免未绑定账号无意义刷新，并阻止旧游戏内存覆盖恢复后的存档 |
| 为未绑定账号自动绑定当前存档 | 使设备 A 首次登录即可建立关联，设备 B 后续登录即可自动恢复 |

## 问题记录

| 问题 | 处理 |
|------|------|
| CodeGraph 宽泛查询结果噪音较多且输出截断 | 改为查询 `createCloudSaveController`、`restoreBoundSave`、`afterSignedIn` 等精确符号 |
| 一次过程文件补丁因中英文表头不匹配而失败 | 读取当前文件后按实际中文表头重新应用 |
| 首次浏览器 `eval` 受 PowerShell 引号影响产生正则语法错误 | 按 Agent-Browser Skill 改用 `eval --stdin`，随后成功 |
| 浏览器会话首次验证时本地服务已退出 | 重启 4173 后重新验证 |
| `agent-browser click @e1` 被 PowerShell 解释 | 使用引号包裹元素引用 |
