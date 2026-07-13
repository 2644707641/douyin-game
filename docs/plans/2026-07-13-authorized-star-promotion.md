# 指定账号段位升星测试功能实施计划

## 任务 1：授权与存档变更失败用例

- 在 `tests/web-platform-patch.test.js` 中增加生产函数抽取测试。
- 验证 `xuwang` 被授权、其他账号被拒绝。
- 验证合法 `playerData` 的 `_curStar` 精确增加 1、`_saveTime` 更新。
- 运行测试并确认因功能不存在而失败。

## 任务 2：最小业务实现

- 在 `createAccountController` 中增加授权判断函数。
- 增加安全解析、升星、flush、资料同步和刷新流程。
- 保持 `bundle.js` 不变。
- 运行测试并确认转绿。

## 任务 3：账号面板入口

- 增加测试区和“段位 +1 星”按钮。
- 保存按钮引用，并在 `updatePanelState()` 控制 hidden/disabled。
- 点击处理复用 `withPanelAction()`，操作前再次鉴权。
- 增加非授权不可见/禁用的测试并转绿。

## 任务 4：错误与回滚

- 增加存档缺失、损坏、星级上限、上传失败测试。
- 上传失败时恢复原始 JSON，避免本地与云端不一致。
- 确认失败时不刷新。

## 任务 5：验证与交付

- `node --test tests/web-platform-patch.test.js`，超时不超过 60 秒。
- `node --check` 检查补丁和引导脚本。
- `git diff --check` 与最终只读代码审查。
- 启动 `0.0.0.0:4173`，浏览器验证页面和控制台。
- 提供本机与局域网访问地址。
