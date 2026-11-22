const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const database = require('./database');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith('#')) continue;
    const index = row.indexOf('=');
    if (index < 0) continue;
    const key = row.slice(0, index).trim();
    const value = row.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();
const seededCount = database.seedFromJson();
if (seededCount) console.log(`已從遺失物清單.json 匯入 ${seededCount} 筆資料。`);

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 12 * 1024 * 1024) return reject(new Error('請求資料太大。'));
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('請求格式不是有效 JSON。')); }
    });
    req.on('error', reject);
  });
}

function isAllowedImage(value) {
  return typeof value === 'string' && (/^https?:\/\//i.test(value) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value));
}

function requireBotToken(req, res) {
  const expected = process.env.BOT_API_TOKEN;
  if (!expected) {
    json(res, 503, { error: '尚未設定 BOT_API_TOKEN，暫停 BOT 寫入。' });
    return false;
  }
  const actual = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    json(res, 401, { error: 'BOT API Token 無效。' });
    return false;
  }
  return true;
}

async function createLostItem(req, res) {
  if (!requireBotToken(req, res)) return;
  let body;
  try { body = await readBody(req); } catch (error) { return json(res, 400, { error: error.message }); }
  const missing = ['item', 'location', 'image'].filter((field) => typeof body[field] !== 'string' || !body[field].trim());
  if (missing.length) return json(res, 400, { error: `缺少欄位：${missing.join(', ')}` });
  if (!isAllowedImage(body.image)) return json(res, 400, { error: 'image 必須是 http(s) 圖片網址或 data:image。' });
  try {
    const created = database.insertItem({ ...body, source: body.source || 'BOT' });
    return json(res, 201, created);
  } catch (error) {
    return json(res, 400, { error: `資料寫入失敗：${error.message}` });
  }
}

function parseAiJson(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 回傳格式無法解析。');
  return JSON.parse(match[0]);
}

async function verifyIdentity(req, res) {
  if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: '找不到 OPENAI_API_KEY，請設定 .env。' });

  let body;
  try { body = await readBody(req); }
  catch (error) { return json(res, 400, { error: error.message }); }

  const claim = typeof body.claim === 'string' ? body.claim.trim() : '';
  const imageUrl = body.image_url;
  if (!claim) return json(res, 400, { error: '請輸入姓名、學號或其他核對資訊。' });
  if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
    return json(res, 400, { error: '證件圖片網址必須是 http 或 https。' });
  }

  const prompt = `你是校園失物招領的隱私保護身分核對服務。請讀取證件圖片，並比對使用者輸入：${claim}

只回傳 JSON，不要回傳完整姓名、完整學號、身分證字號、生日、地址或任何未遮罩個資。看不清楚、無法確定或需要人工複核時，is_match 必須是 false，requires_manual_review 必須是 true。

格式：{"is_match":true,"confidence":"high","requires_manual_review":false,"safe_reason":"輸入資訊與證件欄位相符"}`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageUrl, detail: 'original' }
          ]
        }],
        max_output_tokens: 250
      })
    });
    const result = await response.json();
    if (!response.ok) return json(res, response.status, { error: result.error?.message || 'AI API 回傳錯誤。' });
    const ai = parseAiJson(result.output_text);
    return json(res, 200, {
      is_match: ai.is_match === true && ai.requires_manual_review !== true,
      confidence: ['high', 'medium', 'low'].includes(ai.confidence) ? ai.confidence : 'low',
      requires_manual_review: ai.requires_manual_review === true,
      safe_reason: typeof ai.safe_reason === 'string' ? ai.safe_reason : '請交由管理員人工確認。'
    });
  } catch (error) {
    return json(res, 502, { error: `AI 核對失敗：${error.message}` });
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8'
};

function serve(req, res, url) {
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(ROOT, requested));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: '找不到頁面。' });
  res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/lost-items') {
    return json(res, 200, { items: database.listItems(url.searchParams.get('keyword') || ''), retention_months: database.RETENTION_MONTHS });
  }
  if (req.method === 'POST' && url.pathname === '/api/lost-items') return createLostItem(req, res);
  if (req.method === 'POST' && url.pathname === '/api/verify-identity') return verifyIdentity(req, res);
  if (req.method === 'GET') return serve(req, res, url);
  return json(res, 405, { error: '不支援的請求方法。' });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`FindU 網站：http://localhost:${PORT}`);
  console.log(`AI 模型：${MODEL}`);
});
