const fs = require('fs');
const path = require('path');

const databasePath = path.join(__dirname, '遺失物清單.json');
const retentionMonths = 6;

function parseFoundDate(value) {
  return new Date(String(value ?? '').replace(' ', 'T'));
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

const items = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
const now = new Date();
const activeItems = items.filter((item) => {
  const foundDate = parseFoundDate(item.date);
  if (Number.isNaN(foundDate.getTime())) return true;
  return addMonths(foundDate, retentionMonths) >= now;
});

fs.writeFileSync(databasePath, `${JSON.stringify(activeItems, null, 2)}\n`, 'utf8');
console.log(`遺失物清理完成：刪除 ${items.length - activeItems.length} 筆，保留 ${activeItems.length} 筆。`);
