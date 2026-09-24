const fs = require('node:fs');
const t = fs.readFileSync('js/classic-ui.js', 'utf8');
const needle = 'data-action="daily"';
const i = t.indexOf(needle);
console.log(JSON.stringify(t.slice(Math.max(0, i - 80), i + 160)));
