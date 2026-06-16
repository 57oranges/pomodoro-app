# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm start          # 启动 Electron 应用（开发模式）
```

没有测试、lint 或 build 脚本。这是一个纯 Electron 项目，直接运行 `npm start` 即可。

## Architecture

### 技术栈
- **Electron 33** — 桌面框架
- **Vanilla JS / HTML / CSS** — 无前端框架，无构建工具
- **localStorage** — 所有数据持久化（设置、任务、番茄记录、UI 状态）
- **Web Audio API** — 计时结束音效（无需音频文件）

### 进程模型

```
main.js (主进程)
  ├── 创建 BrowserWindow，加载 renderer/index.html
  ├── 系统托盘：最小化到托盘，右键菜单（显示/退出）
  ├── IPC handle: 'send-notification' → 桌面通知
  └── 窗口关闭时 hide() 而非 quit()

preload.js (预加载脚本)
  └── contextBridge: window.electronAPI.sendNotification(title, body)

renderer/app.js (渲染进程，所有 UI 逻辑)
  ├── 计时器引擎
  ├── 任务管理
  ├── 统计数据
  ├── 设置面板
  └── localStorage 持久化
```

### 渲染进程核心模块（app.js）

**全局状态对象 `state`：**
- `currentMode` — `'focus'` | `'shortBreak'` | `'longBreak'`
- `timeLeft` / `totalTime` — 秒
- `cycle` — 当前第几轮（每完成一个 focus 算一轮）
- `activeTaskId` — 当前关联的任务 ID

**计时器自动流转：**
```
focus 结束 → 记录番茄完成 → 判断 cycle % longBreakInterval
  → 整除: longBreak
  → 否则: shortBreak
休息结束 → cycle++ → focus
```
每个阶段结束后自动开始下一阶段（`handleTimerEnd` 末尾调用 `startTimer()`）。

**持久化键名（localStorage）：**
- `pomodoro-settings` — 时长设置、静音状态
- `pomodoro-tasks` — 任务数组
- `pomodoro-records` — 每日统计 `[{date, count, totalMinutes}]`（保留 90 天）
- `pomodoro-state` — 当前计时器状态（恢复时 `isRunning` 始终重置为 false）

**设置项：** `focus`(25m), `shortBreak`(5m), `longBreak`(15m), `longBreakInterval`(4轮), `mute`(false)

### 进度环
SVG 圆形进度条，半径 85，周长 `2π × 85 ≈ 534.07`（`TOTAL_DASH` 常量）。通过 `stroke-dashoffset` 控制进度，每秒更新一次。

### 键盘快捷键
- `Space` — 开始/暂停
- `S` — 跳过当前阶段
- `R` — 重置
- 输入框聚焦时不响应快捷键

### 窗口特性
- 大小 420×640，最小 380×560
- CSP 限制：`default-src 'self'`，style 和 script 允许 `'unsafe-inline'`
- 标题随倒计时实时更新（`document.title`）
