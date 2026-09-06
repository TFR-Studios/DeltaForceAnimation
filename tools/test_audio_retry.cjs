/* 模拟 audioFactory 的自动播放拦截重试逻辑,验证修复正确性。
 * 不依赖浏览器,用 mock 的 Audio/window 复现:
 *   1) 首次 play() 被拦截(NotAllowedError)
 *   2) 用户手势(pointerdown)后重试成功
 *   3) 点击播放按钮(暂停动画)时跳过重试,避免"开始又立即暂停"
 * 使用真实异步 setTimeout 以准确模拟浏览器事件时序,场景顺序执行。
 */
const assert = require('assert');

// ---- mock Audio ----
let playCallCount = 0;
let playBlocked = true;
let lastPaused = true;
let currentTime = 0;
const mockAudio = {
  src: '',
  preload: 'auto',
  volume: 1,
  paused: true,
  ended: false,
  playbackRate: 1,
  play() {
    playCallCount++;
    if (playBlocked) {
      return Promise.reject(Object.assign(new Error('play() failed'), { name: 'NotAllowedError' }));
    }
    lastPaused = false;
    return Promise.resolve();
  },
  pause() { lastPaused = true; },
  set currentTime(v) { currentTime = v; },
  get currentTime() { return currentTime; },
};

// ---- mock window ----
const listeners = {};
const mockWindow = {
  addEventListener(type, fn, opts) {
    (listeners[type] = listeners[type] || []).push(fn);
  },
  removeEventListener(type, fn) {
    listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms), // 真实异步 setTimeout
};
global.window = mockWindow;
global.Audio = function () { return mockAudio; };

// ---- 复刻 main.ts 中的 audioFactory ----
const audioFactory = (assetPath) => {
  const el = new Audio();
  el.src = assetPath;
  el.preload = 'auto';
  let wantPlay = false;
  let retryHandler = null;

  const tryPlay = () => {
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e) => {
        if (e && e.name === 'NotAllowedError' && wantPlay && !retryHandler) {
          const onGesture = () => {
            window.removeEventListener('pointerdown', onGesture);
            window.removeEventListener('keydown', onGesture);
            retryHandler = null;
            window.setTimeout(() => { if (wantPlay) tryPlay(); }, 0);
          };
          retryHandler = onGesture;
          window.addEventListener('pointerdown', onGesture, { once: true });
          window.addEventListener('keydown', onGesture, { once: true });
        }
      });
    }
  };

  const setVolume = (v) => { if (v !== undefined) el.volume = v; };
  return {
    play: () => { wantPlay = true; tryPlay(); },
    pause: () => { wantPlay = false; el.pause(); },
    seek: (t) => { if (t !== undefined) el.currentTime = t; return el.currentTime; },
    playing: () => !el.paused && !el.ended,
    rate: (r) => { if (r !== undefined) el.playbackRate = r; },
    volume: setVolume,
    setVolume,
  };
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const reset = () => {
  playCallCount = 0; playBlocked = true; lastPaused = true; currentTime = 0;
  for (const k of Object.keys(listeners)) delete listeners[k];
};

(async () => {
  // ---- 场景 1: 自动播放被拦截,用户点击页面任意位置后重试成功 ----
  reset();
  {
    const audio = audioFactory('/test.wav');
    audio.play(); // lottie 在 autoplay 时调用
    await flush(); // 等待 catch 微任务注册监听
    assert.strictEqual(playCallCount, 1, '首次 play() 应被调用');
    assert.strictEqual(lastPaused, true, '首次 play() 被拦截后应仍处于暂停');
    assert.ok(listeners.pointerdown && listeners.pointerdown.length === 1, '应注册 pointerdown 重试监听');

    playBlocked = false; // 用户手势后浏览器放行
    listeners.pointerdown[0](); // 模拟用户点击
    await flush(); // 等待 setTimeout(0) 重试
    assert.strictEqual(playCallCount, 2, '用户手势后应重试 play()');
    assert.strictEqual(lastPaused, false, '重试成功后应处于播放状态');
    assert.ok(!listeners.pointerdown || listeners.pointerdown.length === 0, '重试后应移除监听');
    console.log('场景1 通过: 自动播放被拦截 -> 用户点击 -> 重试成功');
  }

  // ---- 场景 2: 点击的是播放按钮(会暂停动画),应跳过重试 ----
  reset();
  {
    const audio = audioFactory('/test.wav');
    audio.play();
    await flush();
    assert.strictEqual(playCallCount, 1);
    assert.ok(listeners.pointerdown && listeners.pointerdown.length === 1);

    // 模拟点击播放按钮: pointerdown 触发重试监听,随后 click 暂停动画(wantPlay=false)
    listeners.pointerdown[0]();
    audio.pause(); // 播放按钮的 click 处理器调用 anim.pause() -> audio.pause()
    await flush(); // setTimeout(0) 在 click 之后执行,此时 wantPlay 为 false
    assert.strictEqual(playCallCount, 1, '暂停动画后不应重试 play()');
    assert.strictEqual(lastPaused, true, '应保持暂停');
    console.log('场景2 通过: 点击播放按钮暂停动画 -> 跳过重试,无"开始又立即暂停"');
  }

  // ---- 场景 3: 允许自动播放时,首次 play() 直接成功 ----
  reset();
  {
    playBlocked = false;
    const audio = audioFactory('/test.wav');
    audio.play();
    await flush();
    assert.strictEqual(playCallCount, 1);
    assert.strictEqual(lastPaused, false, '允许自动播放时直接播放');
    assert.ok(!listeners.pointerdown || listeners.pointerdown.length === 0, '不应注册重试监听');
    console.log('场景3 通过: 允许自动播放 -> 直接播放成功');
  }

  // ---- 场景 4: 暂停后再次播放(用户点播放按钮第二下),直接成功 ----
  reset();
  {
    playBlocked = false;
    const audio = audioFactory('/test.wav');
    audio.play();
    audio.pause();
    assert.strictEqual(lastPaused, true);
    audio.play(); // 第二下点击播放
    await flush();
    assert.strictEqual(playCallCount, 2);
    assert.strictEqual(lastPaused, false, '暂停后再次播放应成功');
    console.log('场景4 通过: 暂停后再次播放 -> 直接成功');
  }

  console.log('\n全部 4 个场景验证通过: 音频自动播放拦截修复逻辑正确。');
})().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
