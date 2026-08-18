const fs = require("fs");
const p = "I:/Delta Force custom animation/animation/animation_data.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
console.log("version:", j.v);
console.log("size:", j.w + "x" + j.h, " fr:", j.fr, " ip:", j.ip, " op:", j.op);
console.log("assets:", j.assets.length);
const imgAssets = j.assets.filter(a => a.p || a.u);
console.log("image/precomp assets:", imgAssets.length);
imgAssets.slice(0, 10).forEach(a => console.log("  id=" + a.id + " u=" + a.u + " p=" + a.p));
// walk all layers recursively for text layers
const texts = [];
function walk(layers, prefix) {
  for (const l of layers) {
    if (l.ty === 5) {
      const td = l.t && l.t.d && l.t.d.k;
      const txt = Array.isArray(td) ? (td[0] && td[0].s && td[0].s.t) : (td && td.s && td.s.t);
      texts.push({ ind: l.ind, nm: l.nm, text: txt });
    }
    if (l.layers) walk(l.layers, prefix + "  ");
  }
}
walk(j.layers, "");
console.log("text layers (recursive):", texts.length);
texts.slice(0, 20).forEach(t => console.log("  ind=" + t.ind + " nm=" + t.nm + " text=[" + t.text + "]"));
console.log("fonts:", (j.fonts && j.fonts.list || []).map(f => f.fName + " (" + f.fFamily + ")").join(", "));
console.log("top-level layers:", j.layers.length);
