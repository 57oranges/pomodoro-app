/* ========================================
   番茄钟 - 核心逻辑
   ======================================== */

// ======== 常量 ========
const DEFAULT_SETTINGS = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakInterval: 4,
  mute: false
};

const MODE_META = {
  focus: { label: '专注', color: '#00d4ff' },
  shortBreak: { label: '短休息', color: '#00ff88' },
  longBreak: { label: '长休息', color: '#ffd93d' }
};

const TOTAL_DASH = 534.07; // 2π × 85 ≈ 534.07

// ======== 全局状态 ========
let state = {
  currentMode: 'focus',       // 'focus' | 'shortBreak' | 'longBreak'
  timeLeft: 25 * 60,          // 剩余秒数
  totalTime: 25 * 60,         // 当前模式总秒数
  cycle: 1,                   // 当前是第几轮（每 focus 为一轮）
  isRunning: false,
  activeTaskId: null,         // 当前关联的任务 ID
  completedInSession: 0       // 本次会话完成的番茄数
};

let timerInterval = null;
let settings = { ...DEFAULT_SETTINGS };
let tasks = [];
let records = []; // [{ date: 'YYYY-MM-DD', count: N, totalMinutes: M }]

// ======== 音频 ========
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playBeep(type = 'focusEnd') {
  if (settings.mute) return;

  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    if (type === 'focusEnd') {
      // 三连音
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);
      oscillator.frequency.setValueAtTime(1320, ctx.currentTime + 0.24);
    } else if (type === 'breakEnd') {
      // 柔和上升音
      oscillator.frequency.setValueAtTime(523, ctx.currentTime);
      oscillator.frequency.linearRampToValueAtTime(784, ctx.currentTime + 0.3);
    }

    oscillator.type = 'sine';
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // 静默处理音频错误
  }
}

// ======== 持久化 ========
function saveData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // localStorage 满了或不可用
  }
}

function loadData(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function persistAll() {
  saveData('pomodoro-settings', settings);
  saveData('pomodoro-tasks', tasks);
  saveData('pomodoro-records', records);
  saveData('pomodoro-state', {
    currentMode: state.currentMode,
    timeLeft: state.timeLeft,
    totalTime: state.totalTime,
    cycle: state.cycle,
    isRunning: false,  // 重新打开时不自动运行
    activeTaskId: state.activeTaskId
  });
}

function loadAll() {
  settings = loadData('pomodoro-settings', { ...DEFAULT_SETTINGS });
  tasks = loadData('pomodoro-tasks', []);
  records = loadData('pomodoro-records', []);

  const savedState = loadData('pomodoro-state', null);
  if (savedState) {
    state.currentMode = savedState.currentMode || 'focus';
    state.timeLeft = savedState.timeLeft || settings.focus * 60;
    state.totalTime = savedState.totalTime || settings.focus * 60;
    state.cycle = savedState.cycle || 1;
    state.isRunning = false; // 始终从不运行状态开始
    state.activeTaskId = savedState.activeTaskId || null;
  } else {
    resetStateForMode('focus');
  }
}

// ======== 状态管理 ========
function resetStateForMode(mode) {
  const minutes = settings[mode] || DEFAULT_SETTINGS[mode];
  state.currentMode = mode;
  state.timeLeft = minutes * 60;
  state.totalTime = minutes * 60;
  state.isRunning = false;
}

function getModeMinutes(mode) {
  return settings[mode] || DEFAULT_SETTINGS[mode];
}

// ======== 计时器逻辑 ========
function startTimer() {
  if (state.isRunning) return;
  state.isRunning = true;
  updateStartButton();
  persistAll();

  timerInterval = setInterval(() => {
    state.timeLeft--;
    updateTimerDisplay();
    updateProgressRing();

    if (state.timeLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      handleTimerEnd();
    }
  }, 1000);
}

function pauseTimer() {
  state.isRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  updateStartButton();
  persistAll();
}

function skipTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  state.timeLeft = 0;
  handleTimerEnd();
}

function resetTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const minutes = getModeMinutes(state.currentMode);
  state.timeLeft = minutes * 60;
  state.totalTime = minutes * 60;
  state.isRunning = false;
  updateTimerDisplay();
  updateProgressRing();
  updateStartButton();
  persistAll();
}

function handleTimerEnd() {
  const previousMode = state.currentMode;
  playBeep(previousMode === 'focus' ? 'focusEnd' : 'breakEnd');
  sendNotificationForMode(previousMode);

  if (previousMode === 'focus') {
    // 记录完成的番茄钟
    recordPomodoroCompletion();
    state.completedInSession++;

    // 判断进入长休息还是短休息
    if (state.cycle % settings.longBreakInterval === 0) {
      switchMode('longBreak');
    } else {
      switchMode('shortBreak');
    }
  } else {
    // 休息结束 → 新专注
    state.cycle++;
    switchMode('focus');
  }

  // 自动开始下一阶段
  startTimer();
}

function switchMode(mode) {
  const minutes = getModeMinutes(mode);
  state.currentMode = mode;
  state.timeLeft = minutes * 60;
  state.totalTime = minutes * 60;
  updateModeTabs();
  updateTimerDisplay();
  updateProgressRing();
  updateCycleIndicator();
  updateStartButton();
  persistAll();
}

function manualSwitchMode(mode) {
  if (state.isRunning) {
    pauseTimer();
  }
  if (mode === 'focus') {
    state.cycle = Math.max(1, state.cycle);
  }
  switchMode(mode);
}

// ======== 统计记录 ========
function recordPomodoroCompletion() {
  const today = getDateString();
  const minutes = getModeMinutes('focus');

  let record = records.find(r => r.date === today);
  if (record) {
    record.count++;
    record.totalMinutes += minutes;
  } else {
    records.push({ date: today, count: 1, totalMinutes: minutes });
  }

  // 只保留最近 90 天的记录
  records = records.slice(-90);

  updateStats();
  persistAll();
}

function getDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ======== 通知 ========
async function sendNotificationForMode(mode) {
  const titles = {
    focus: '🍅 专注时间结束！',
    shortBreak: '☕ 短休息结束',
    longBreak: '🌴 长休息结束'
  };
  const bodies = {
    focus: state.cycle % settings.longBreakInterval === 0
      ? '辛苦了！该来一次长休息了 🌴'
      : '太棒了！休息一下吧 ☕',
    shortBreak: '休息结束，准备好继续了吗？',
    longBreak: '充好电了！开始新的番茄钟吧 🚀'
  };

  try {
    if (window.electronAPI) {
      await window.electronAPI.sendNotification(titles[mode], bodies[mode]);
    }
  } catch (e) {
    // 非 Electron 环境（浏览器调试）时忽略
  }
}

// ======== UI 更新 ========
function updateTimerDisplay() {
  const mins = Math.floor(state.timeLeft / 60);
  const secs = state.timeLeft % 60;
  document.getElementById('timer-minutes').textContent = String(mins).padStart(2, '0');
  document.getElementById('timer-seconds').textContent = String(secs).padStart(2, '0');
  document.title = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} - ${MODE_META[state.currentMode].label}`;

  // 最后 60 秒变色警告
  const timerText = document.querySelector('.timer-text');
  if (state.timeLeft <= 60 && state.currentMode === 'focus') {
    timerText.style.color = '#ff6b6b';
  } else {
    timerText.style.color = '';
  }
}

function updateProgressRing() {
  const ring = document.getElementById('ring-progress');
  const progress = 1 - (state.timeLeft / state.totalTime);
  const offset = TOTAL_DASH * progress;
  ring.setAttribute('stroke-dashoffset', offset);
}

function updateModeTabs() {
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === state.currentMode);
  });
}

function updateCycleIndicator() {
  const el = document.getElementById('cycle-indicator');
  if (state.currentMode === 'focus') {
    el.textContent = `第 ${state.cycle} 轮`;
  } else {
    el.textContent = `${MODE_META[state.currentMode].label}`;
  }
}

function updateStartButton() {
  const btn = document.getElementById('btn-start');
  if (state.isRunning) {
    btn.textContent = '暂停';
    btn.classList.add('pause');
  } else {
    btn.textContent = '开始';
    btn.classList.remove('pause');
  }
}

function updateActiveTaskDisplay() {
  const nameEl = document.getElementById('active-task-name');
  if (state.activeTaskId) {
    const task = tasks.find(t => t.id === state.activeTaskId);
    nameEl.textContent = task ? task.title : '无';
  } else {
    nameEl.textContent = '无';
  }
}

function updateStats() {
  const today = getDateString();
  const todayRecord = records.find(r => r.date === today) || { count: 0, totalMinutes: 0 };

  // 本周统计
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((dayOfWeek + 6) % 7)); // 周一开始
  const startOfWeekStr = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, '0')}-${String(startOfWeek.getDate()).padStart(2, '0')}`;

  let weekCount = 0;
  records.forEach(r => {
    if (r.date >= startOfWeekStr) {
      weekCount += r.count;
    }
  });

  const totalCount = records.reduce((sum, r) => sum + r.count, 0);
  const totalMinutes = records.reduce((sum, r) => sum + (r.totalMinutes || r.count * settings.focus), 0);
  const totalHours = Math.floor(totalMinutes / 60);

  document.getElementById('stat-today').textContent = todayRecord.count;
  document.getElementById('stat-week').textContent = weekCount;
  document.getElementById('stat-total').textContent = totalCount;
  document.getElementById('stat-hours').textContent = totalHours + 'h';

  updateWeeklyChart();
}

function updateWeeklyChart() {
  const chart = document.getElementById('weekly-chart');
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const record = records.find(r => r.date === dateStr);
    const dayLabels = ['一', '二', '三', '四', '五', '六', '日'];
    days.push({
      label: dayLabels[(d.getDay() + 6) % 7],
      count: record ? record.count : 0
    });
  }

  const maxCount = Math.max(...days.map(d => d.count), 1);

  chart.innerHTML = days.map(d => `
    <div class="chart-bar-wrapper">
      <div class="chart-bar" style="height: ${(d.count / maxCount) * 100}%"></div>
      <span class="chart-bar-label">${d.label}</span>
    </div>
  `).join('');
}

// ======== 任务管理 ========
function addTask(title) {
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    title: title.trim(),
    completed: false,
    createdAt: new Date().toISOString()
  };
  tasks.unshift(task);
  renderTasks();
  persistAll();
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    renderTasks();
    persistAll();
  }
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  if (state.activeTaskId === id) {
    state.activeTaskId = null;
    updateActiveTaskDisplay();
  }
  renderTasks();
  persistAll();
}

function setActiveTask(id) {
  if (state.activeTaskId === id) {
    state.activeTaskId = null; // 取消选择
  } else {
    state.activeTaskId = id;
  }
  updateActiveTaskDisplay();
  renderTasks();
  persistAll();
}

function renderTasks() {
  const list = document.getElementById('task-list');
  const empty = document.getElementById('task-empty');
  const countEl = document.getElementById('task-count');

  const incompleteTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);
  const sortedTasks = [...incompleteTasks, ...completedTasks];

  countEl.textContent = incompleteTasks.length;

  if (sortedTasks.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    list.innerHTML = sortedTasks.map(task => `
      <li class="task-item ${task.completed ? 'completed' : ''} ${task.id === state.activeTaskId ? 'active' : ''}">
        <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}
               onchange="toggleTask('${task.id}')">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <div class="task-actions">
          <button class="task-btn focus" onclick="setActiveTask('${task.id}')"
                  title="${task.id === state.activeTaskId ? '取消关联' : '关联当前番茄'}">
            ${task.id === state.activeTaskId ? '🔗' : '🔓'}
          </button>
          <button class="task-btn delete" onclick="deleteTask('${task.id}')" title="删除">🗑️</button>
        </div>
      </li>
    `).join('');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ======== 设置面板 ========
function openSettings() {
  document.getElementById('setting-focus').value = settings.focus;
  document.getElementById('setting-short-break').value = settings.shortBreak;
  document.getElementById('setting-long-break').value = settings.longBreak;
  document.getElementById('setting-interval').value = settings.longBreakInterval;
  document.getElementById('settings-modal').classList.add('show');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('show');
}

function saveSettings() {
  const focus = parseInt(document.getElementById('setting-focus').value) || 25;
  const shortBreak = parseInt(document.getElementById('setting-short-break').value) || 5;
  const longBreak = parseInt(document.getElementById('setting-long-break').value) || 15;
  const interval = parseInt(document.getElementById('setting-interval').value) || 4;

  settings.focus = Math.max(1, Math.min(120, focus));
  settings.shortBreak = Math.max(1, Math.min(30, shortBreak));
  settings.longBreak = Math.max(1, Math.min(60, longBreak));
  settings.longBreakInterval = Math.max(1, Math.min(10, interval));

  // 如果当前没有在运行，重置计时器以适应新设置
  if (!state.isRunning) {
    const minutes = getModeMinutes(state.currentMode);
    state.timeLeft = minutes * 60;
    state.totalTime = minutes * 60;
    updateTimerDisplay();
    updateProgressRing();
  }

  persistAll();
  closeSettings();
  updateMuteButton();
}

function toggleMute() {
  settings.mute = !settings.mute;
  updateMuteButton();
  persistAll();
}

function updateMuteButton() {
  const btn = document.getElementById('btn-mute');
  btn.textContent = settings.mute ? '🔇' : '🔊';
  btn.title = settings.mute ? '取消静音' : '静音';
  if (settings.mute) {
    btn.classList.add('btn-muted');
  } else {
    btn.classList.remove('btn-muted');
  }
}

// ======== 事件绑定 ========
function bindEvents() {
  // 模式切换
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      manualSwitchMode(tab.dataset.mode);
    });
  });

  // 控制按钮
  document.getElementById('btn-start').addEventListener('click', () => {
    if (state.isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  document.getElementById('btn-skip').addEventListener('click', skipTimer);
  document.getElementById('btn-reset').addEventListener('click', resetTimer);

  // 任务
  document.getElementById('btn-add-task').addEventListener('click', () => {
    const input = document.getElementById('task-input');
    const title = input.value.trim();
    if (title) {
      addTask(title);
      input.value = '';
      input.focus();
    }
  });

  document.getElementById('task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const title = e.target.value.trim();
      if (title) {
        addTask(title);
        e.target.value = '';
      }
    }
  });

  // 设置
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settings-modal')) {
      closeSettings();
    }
  });

  // 静音
  document.getElementById('btn-mute').addEventListener('click', toggleMute);

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; // 不在输入框中响应

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (state.isRunning) {
          pauseTimer();
        } else {
          startTimer();
        }
        break;
      case 'KeyS':
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+S 不触发（浏览器默认）
        } else {
          skipTimer();
        }
        break;
      case 'KeyR':
        if (!e.ctrlKey && !e.metaKey) {
          resetTimer();
        }
        break;
    }
  });

  // 窗口关闭前保存状态
  window.addEventListener('beforeunload', () => {
    state.isRunning = false;
    persistAll();
  });
}

// ======== 初始化 ========
function init() {
  loadAll();
  updateTimerDisplay();
  updateProgressRing();
  updateModeTabs();
  updateCycleIndicator();
  updateStartButton();
  updateActiveTaskDisplay();
  updateStats();
  updateMuteButton();
  renderTasks();
  bindEvents();

  // 定期持久化（以防意外关闭）
  setInterval(() => {
    if (state.isRunning) {
      persistAll();
    }
  }, 10000);

  console.log('🍅 番茄钟已就绪！');
}

// 启动
document.addEventListener('DOMContentLoaded', init);
