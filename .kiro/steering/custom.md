---
inclusion: always
---

# 用户约束

- 请使用中文回答
- 执行 task 时，当完成一个小任务后，继续往后执行，拥有所有权限
- 不要主动创建新的文档和总结
- 所有功能，优先使用和复用已有系统的功能
- 不要每次都写文档。除非用户要求，否则不要写文档
- 没有用户同意，不允许创建测试页面
- 调试完成后，如果要删除调试信息，要先询问用户是否同意删除，不要自动删除
- gogame是后端引擎，html5-mmrpg-game是前端引擎
- cmd/demo中，需要包含html5-mmrpg-game的代码，尽量采用html5-mmrpg-game的代码
- cmd/demo的前端，尽量使用html5-mmrpg-game/src/prologue中的代码，不要自己另外写。
- 添加和修改前端页面时，先参考一下 #html5-mmrpg-game/docs/usage_guide.md
如果已经有功能，则复用。如果没有功能，则写出功能后，抽象成好调用的函数或类，放到父模块中。包括cmd/demo中调用的js，以及html5-mmrpg-game中的js。


## 代码探索方法论

### 搜索陌生功能时的正确姿势
- 不要用视觉效果名称搜索（如 `renderAttackRange`），要从**数据/状态**角度切入（如 `selectedTarget`、`dead`）
- 对不知道关键词的情况，优先用 `readCode` 看类的方法签名列表，再按方法名逐个深入，比盲目 `grepSearch` 效率高得多

### 状态限制的完整性原则
给某个状态（如灵魂状态、眩晕等）加限制时，需要覆盖所有入口层：
1. 执行层（实际发送消息/造成效果的函数）
2. 交互层（选中目标、点击按钮等 UI 入口）
3. 状态清理（进入该状态时清除残留的交互状态，如 `selectedTarget`）

漏掉任何一层都会有残留的视觉或交互 bug。


## Steering 文件分工

- `project-overview.md` — 项目整体结构、技术栈、目录说明
- `cmd-demo.md` — 修罗斗场 Demo 的具体实现细节、消息协议、开发注意事项
- `custom.md` — 用户约束、开发习惯、通用方法论

追加知识时按内容层次选择目标文件：具体场景细节 → `cmd-demo.md`，通用方法论 → `custom.md`，项目结构变化 → `project-overview.md`。追加前确认目标文件是否已有类似条目，避免重复。


## Go 后端调试技巧

- `go build . 2>&1` 在 Windows bash 里可能 exit code -1 但无输出（shell 重定向问题）
- 检查 Go 文件语法优先用 `getDiagnostics` 工具，比跑 shell 命令更可靠


### Bug 排查：后端数据正确但前端表现异常时
- 确认后端数据无误后，立刻看 `BaseGameScene.update` 的调用链，逐个检查父类系统（CombatSystem、MeditationSystem 等）是否有修改相关状态的逻辑
- 从 `update` 调用链自顶向下排查，比盲目 grep 关键词高效得多
- 特别注意单机引擎自带的逻辑（如自动复活、自动回血）在多人联网场景下可能产生冲突


## 联网/单机行为分离模式

当单机引擎的某个系统（如 CombatSystem）有自动逻辑（自动复活、自动回血等）与联网场景冲突时：
1. 在系统上设 `_arenaMode` 布尔标志
2. 联网场景 `enter` 时设 `true`，`exit` 时清 `false`
3. 系统内部检测标志，跳过单机专属逻辑

比 `_safeZoneDisabled`（每帧设/清）更适合场景级别的持久开关。

## 2.5D 椭圆判定一致性

渲染用椭圆时，碰撞判定也必须用椭圆公式 `(dx/rx)² + (dy/ry)² <= 1`，不能用圆形近似。前后端必须同步修改判定逻辑。
