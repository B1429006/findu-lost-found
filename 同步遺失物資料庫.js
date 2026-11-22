const fs = require('fs');
const path = require('path');

const root = __dirname;
const jsonPath = path.join(root, '遺失物清單.json');
const jsPath = path.join(root, '遺失物清單.js');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

fs.writeFileSync(jsPath, `window.lostItemDatabase = ${JSON.stringify(data, null, 2)};\n`, 'utf8');
console.log(`網頁資料庫同步完成：${data.length} 筆。`);
