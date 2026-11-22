const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = __dirname;
const RETENTION_MONTHS = 6;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});
let initialized;

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

async function insertRow(item) {
  const foundDate = parseDate(item.date) || new Date();
  const verificationRequired = Boolean(item.verification_required);
  const result = await pool.query(`
    INSERT INTO lost_items
      (type, item, keywords, location, storage_location, details, date, image, source, verification_required, verification_prompt, created_at, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    item.type || 'found', String(item.item).trim(), String(item.keywords || '').trim(), String(item.location).trim(),
    String(item.storage_location || '學務處失物招領室').trim(), safeDetails(item.details, verificationRequired), formatDate(foundDate),
    String(item.image).trim(), String(item.source || 'BOT').trim(), verificationRequired,
    verificationRequired ? String(item.verification_prompt || '請輸入姓名、學號或證件上其他可核對本人身分的資訊') : null,
    formatDate(new Date()), addMonths(foundDate, RETENTION_MONTHS)
  ]);
  return toPublic(result.rows[0]);
}

function ensureSchema() {
  if (!initialized) {
    initialized = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lost_items (
          id BIGSERIAL PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'found',
          item TEXT NOT NULL,
          keywords TEXT NOT NULL DEFAULT '',
          location TEXT NOT NULL,
          storage_location TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          date TEXT NOT NULL,
          image TEXT NOT NULL,
          source TEXT NOT NULL,
          verification_required BOOLEAN NOT NULL DEFAULT FALSE,
          verification_prompt TEXT,
          created_at TIMESTAMP NOT NULL,
          expires_at TIMESTAMP NOT NULL
        )
      `);
      const count = Number((await pool.query('SELECT COUNT(*)::int AS count FROM lost_items')).rows[0].count);
      if (count === 0) {
        const jsonPath = path.join(ROOT, '遺失物清單.json');
        if (fs.existsSync(jsonPath)) {
          const items = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          for (const item of items) if (item.item && item.location && item.image) await insertRow(item);
        }
      }
    })();
  }
  return initialized;
}

async function cleanupExpired() {
  await ensureSchema();
  const result = await pool.query("DELETE FROM lost_items WHERE expires_at <= NOW()");
  return result.rowCount;
}

async function listItems(keyword = '') {
  await cleanupExpired();
  const result = await pool.query("SELECT * FROM lost_items WHERE type = 'found' AND expires_at > NOW() ORDER BY date DESC");
  const query = String(keyword).trim().toLowerCase();
  return result.rows.map(toPublic).filter((item) => !query || `${item.item} ${item.keywords} ${item.location} ${item.date}`.toLowerCase().includes(query));
}

async function insertItem(item) {
  await ensureSchema();
  return insertRow(item);
}

function seedFromJson() {
  return 0;
}

module.exports = { RETENTION_MONTHS, cleanupExpired, insertItem, listItems, seedFromJson };
