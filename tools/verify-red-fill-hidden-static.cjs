/* 统计:按「纯红填充隐藏」规则,每套动画各有多少形状图层的填充编辑会被隐藏(静态核对,不依赖浏览器)。 */
const fs = require('fs');
const list = { '撤离动画': 'animation/animation_data.json', '位置暴露动画': 'animation_2/animation_data.json', '核电站功率动画': 'animation_3/animation_data.json', '任务弹窗动画': 'animation_4/animation_data.json' };
const hex = (fc) => '#' + fc.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
for (const [name, p] of Object.entries(list)) {
  const d = JSON.parse(fs.readFileSync('I:/Delta Force custom animation/' + p, 'utf8'));
  const hidden = [], shown = [];
  const walkLayers = (layers) => {
    for (const l of layers || []) {
      if (Array.isArray(l.layers)) walkLayers(l.layers);
      if (l.ty !== 4 || l.td === 1) continue;
      const fills = [];
      const w = (it) => { for (const x of it || []) { if (x.ty === 'fl') fills.push(x); if (Array.isArray(x.it)) w(x.it); } };
      w(l.shapes);
      if (!fills.length || !fills[0].c || fills[0].c.a !== 0) continue;
      const h = hex(fills[0].c.k);
      (h === '#ff0000' ? hidden : shown).push(l.nm + '(' + h + ')');
    }
  };
  walkLayers(d.layers);
  console.log('=== ' + name + ' ===');
  console.log('  隐藏填充编辑(纯红 #ff0000):' + hidden.length + ' 个 → ' + (hidden.join('、') || '(无)'));
  console.log('  仍可编辑填充:' + shown.length + ' 个 → ' + (shown.join('、') || '(无)'));
}
