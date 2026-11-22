const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATABASE_PATH = process.env.DB_PATH || path.join(ROOT, '遺失物清單.db');
const RETENTION_MONTHS = 6;
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const db = new DatabaseSync(DATABASE_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS lost_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'found',
    item TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    storage_location TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    image TEXT NOT NULL,
    source TEXT NOT NULL,
    verification_required INTEGER NOT NULL DEFAULT 0,
    verification_prompt TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
`);

function parseDate(value) {
  const date = new Date(String(value || '').replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function safeDetails(value, verificationRequired) {
  const details = String(value || '').trim();
  if (!verificationRequired) return details;
  const safeFields = details.match(/(?:姓名|學號)\s*[:：]\s*[^，,；;。]+/g) || [];
  return safeFields.length ? safeFields.join('、') : '姓名或學號已隱藏';
}

function toPublic(row) {
  return {
    id: Number(row.id), type: row.type, item: row.item, keywords: row.keywords,
    location: row.location, storage_location: row.storage_location, details: row.details,
    date: row.date, image: row.image, source: row.source,
    verification_required: Boolean(row.verification_required),
    verification_prompt: row.verification_prompt || null
  };
}

function cleanupExpired() {
  return db.prepare("DELETE FROM lost_items WHERE expires_at <= datetime('now', 'localtime')").run().changes;
}

function insertItem(item) {
  const foundDate = parseDate(item.date) || new Date();
  const now = new Date();
  const verificationRequired = Boolean(item.verification_required);
  const result = db.prepare(`
    INSERT INTO lost_items
      (type, item, keywords, location, storage_location, details, date, image, source, verification_required, verification_prompt, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.type || 'found', String(item.item).trim(), String(item.keywords || '').trim(), String(item.location).trim(),
    String(item.storage_location || '學務處失物招領室').trim(), safeDetails(item.details, verificationRequired), formatDate(foundDate),
    String(item.image).trim(), String(item.source || 'BOT').trim(), verificationRequired ? 1 : 0,
    verificationRequired ? String(item.verification_prompt || '請輸入姓名、學號或證件上其他可核對本人身分的資訊') : null,
    formatDate(now), formatDate(addMonths(foundDate, RETENTION_MONTHS))
  );
  return toPublic(db.prepare('SELECT * FROM lost_items WHERE id = ?').get(Number(result.lastInsertRowid)));
}

function seedFromJson() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM lost_items').get().count;
  if (Number(count) > 0) return 0;
  const file = path.join(ROOT, '遺失物清單.json');
  if (!fs.existsSync(file)) return 0;
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const item of items) if (item.item && item.location && item.image) insertItem(item);
  return items.length;
}

function listItems(keyword = '') {
  cleanupExpired();
  const rows = db.prepare("SELECT * FROM lost_items WHERE type = 'found' AND expires_at > datetime('now', 'localtime') ORDER BY datetime(date) DESC").all();
  const query = String(keyword).trim().toLowerCase();
  return rows.map(toPublic).filter((item) => !query || `${item.item} ${item.keywords} ${item.location} ${item.date}`.toLowerCase().includes(query));
}

module.exports = { DATABASE_PATH, RETENTION_MONTHS, cleanupExpired, insertItem, listItems, seedFromJson };
