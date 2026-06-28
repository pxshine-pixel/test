/**
 * 内置示例 K 线（确定性生成，无需联网即可体验技术分析）。
 * 走势：上涨 → 高位放量 → 回调 → 在密集区企稳回升，便于演示各类信号。
 */
(function (global) {
  function gen() {
    const bars = [];
    let price = 50;
    // 用确定性的正弦+趋势制造“真实感”，不依赖随机数
    const start = Date.UTC(2024, 0, 2);
    for (let i = 0; i < 120; i++) {
      // 分段趋势：0-50 上涨，50-75 高位震荡，75-95 回调，95-120 回升
      let drift;
      if (i < 50) drift = 0.55;
      else if (i < 75) drift = 0.0;
      else if (i < 95) drift = -0.7;
      else drift = 0.5;
      const wave = Math.sin(i / 6) * 0.9 + Math.sin(i / 2.3) * 0.4;
      price = Math.max(5, price + drift + wave);
      const open = price - wave * 0.5;
      const close = price;
      const high = Math.max(open, close) + Math.abs(wave) * 0.6 + 0.3;
      const low = Math.min(open, close) - Math.abs(wave) * 0.6 - 0.3;
      // 高位与回调放量，模拟密集成交区
      let vol = 8000 + Math.abs(wave) * 3000;
      if (i >= 60 && i < 95) vol += 12000;        // 高位/回调放量 → 上方密集区
      if (i >= 95) vol += 6000;                    // 回升温和放量
      const d = new Date(start + i * 86400000);
      bars.push({
        date: d.toISOString().slice(0, 10),
        open: round(open), high: round(high), low: round(low),
        close: round(close), volume: Math.round(vol),
      });
    }
    return bars;
  }
  function round(n) { return Math.round(n * 100) / 100; }

  global.SAMPLE_BARS = gen();
})(window);
