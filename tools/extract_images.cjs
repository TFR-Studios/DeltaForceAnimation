const fs = require('fs');
const path = 'i:/Delta Force custom animation/animation_2/animation_data.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const a of data.assets) {
  if (typeof a.p === 'string' && a.p.startsWith('data:image')) {
    const m = a.p.match(/^data:image\/(\w+);base64,(.*)$/);
    if (m) {
      const buf = Buffer.from(m[2], 'base64');
      const fname = 'i:/Delta Force custom animation/tools/' + a.id + '.' + m[1];
      fs.writeFileSync(fname, buf);
      console.log(a.id + ' -> ' + fname + ' (' + buf.length + ' bytes, ' + a.w + 'x' + a.h + ')');
    }
  }
}
