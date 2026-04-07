'use strict';

require('dotenv').config();

const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const https   = require('https');
const http    = require('http');

const express  = require('express');
const session  = require('express-session');
const helmet   = require('helmet');
const multer   = require('multer');
const mysql    = require('mysql2/promise');
const sharp    = require('sharp');
const { parse: parseCsv } = require('csv-parse/sync');

const requireAuth = require('./middleware/auth');

// ── DB pool ──────────────────────────────────────────────────────────────────

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'animewallpaperz',
  waitForConnections: true,
  connectionLimit: 10,
});

// ── Directories ───────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, 'wallpapers');
const TEMP_DIR   = path.join(__dirname, 'tmp');

for (const dir of [UPLOAD_DIR, TEMP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function safeFilename(originalName, prefix = '') {
  const ext  = path.extname(originalName).toLowerCase();
  const base = slugify(path.basename(originalName, ext)) || 'image';
  return `${prefix || Date.now()}-${base}${ext}`;
}

/**
 * Convert any image to WebP and save alongside the original.
 * Returns { webpFilename, webpSize }.
 */
async function makeWebP(originalPath, baseName) {
  const webpFilename = baseName + '.webp';
  const webpPath     = path.join(UPLOAD_DIR, webpFilename);

  await sharp(originalPath)
    .webp({ quality: 85, effort: 4 })
    .toFile(webpPath);

  const { size } = fs.statSync(webpPath);
  return { webpFilename, webpSize: size };
}

/**
 * Download an image from a URL to a local temp file.
 * Follows up to 5 redirects. Returns the saved temp path.
 */
function downloadImage(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));

    const mod = url.startsWith('https') ? https : http;

    mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadImage(res.headers.location, destPath, redirects + 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const contentType = res.headers['content-type'] || '';
      if (!contentType.startsWith('image/')) {
        return reject(new Error(`Not an image (content-type: ${contentType})`));
      }

      const stream = fs.createWriteStream(destPath);
      res.pipe(stream);
      stream.on('finish', () => resolve(destPath));
      stream.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error('Request timed out')));
  });
}

/**
 * Save one wallpaper entry: move original to UPLOAD_DIR, generate WebP, insert DB.
 * meta: { title, tags, category, slug, alt_text, seo_title, meta_desc, og_title, og_description }
 */
async function saveWallpaper(tmpOriginalPath, originalFilename, meta) {
  const prefix    = Date.now();
  const ext       = path.extname(originalFilename).toLowerCase();
  const base      = slugify(path.basename(originalFilename, ext)) || 'image';
  const origName  = `${prefix}-${base}${ext}`;
  const origPath  = path.join(UPLOAD_DIR, origName);

  // Move from temp → wallpapers
  fs.renameSync(tmpOriginalPath, origPath);

  const origSize = fs.statSync(origPath).size;

  // Generate WebP for web display
  const { webpFilename, webpSize } = await makeWebP(origPath, `${prefix}-${base}`);

  const finalSlug = meta.slug
    ? slugify(meta.slug)
    : slugify(meta.title) + '-' + prefix;

  const [result] = await pool.query(
    `INSERT INTO wallpapers
      (filename_original, filename_webp, title, tags, category,
       size_original, size_webp, slug, alt_text, seo_title, meta_desc, og_title, og_description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      origName,
      webpFilename,
      meta.title.trim(),
      (meta.tags || '').trim(),
      (meta.category || '').trim(),
      origSize,
      webpSize,
      finalSlug,
      (meta.alt_text || '').trim(),
      (meta.seo_title || '').trim(),
      (meta.meta_desc || '').trim(),
      (meta.og_title || '').trim(),
      (meta.og_description || '').trim(),
    ]
  );

  return { id: result.insertId, origName, webpFilename, finalSlug };
}

// ── Multer (CSV + single image uploads) ───────────────────────────────────────

// Single image: save to temp dir first, we'll move it after processing
const imgStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const base = slugify(path.basename(file.originalname, ext)) || 'image';
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const uploadImage = multer({
  storage: imgStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max (original can be large)
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files (JPEG, PNG, WEBP, GIF, TIFF) are allowed'));
  },
});

// CSV upload: save to temp dir
const csvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  filename: (_req, _file, cb) => cb(null, `bulk-${Date.now()}.csv`),
});

const uploadCsv = multer({
  storage: csvStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only CSV files are accepted'));
  },
});

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    maxAge:   8 * 60 * 60 * 1000,
    secure:   process.env.NODE_ENV === 'production',
  },
}));

// ── Static ────────────────────────────────────────────────────────────────────

app.use('/wallpapers', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(__dirname, { index: false }));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const submitted = String(req.body.password || '');
  const expected  = String(process.env.ADMIN_PASSWORD || '');

  let match = false;
  if (submitted.length === expected.length) {
    try {
      match = crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
    } catch { /* length mismatch edge case */ }
  }

  if (match) { req.session.authed = true; return res.json({ ok: true }); }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Images ────────────────────────────────────────────────────────────────────

app.get('/api/images', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM wallpapers ORDER BY uploaded_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Single upload: receives one image file + metadata fields
app.post('/api/upload', requireAuth, uploadImage.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const { title = '', tags = '', category = '', slug = '',
          alt_text = '', seo_title = '', meta_desc = '',
          og_title = '', og_description = '' } = req.body;

  if (!title.trim()) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const result = await saveWallpaper(req.file.path, req.file.originalname, {
      title, tags, category, slug, alt_text, seo_title, meta_desc, og_title, og_description,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Delete — removes both original and WebP files
app.delete('/api/images/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  try {
    const [rows] = await pool.query(
      'SELECT filename_original, filename_webp FROM wallpapers WHERE id = ?', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    await pool.query('DELETE FROM wallpapers WHERE id = ?', [id]);

    for (const fname of [rows[0].filename_original, rows[0].filename_webp]) {
      if (fname) {
        fs.unlink(path.join(UPLOAD_DIR, fname), (err) => {
          if (err && err.code !== 'ENOENT') console.warn('Could not delete:', fname);
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', requireAuth, async (_req, res) => {
  try {
    const [[totals]] = await pool.query(`
      SELECT
        COUNT(*)                             AS total_images,
        COALESCE(SUM(size_original), 0)      AS total_size_original,
        COALESCE(SUM(size_webp), 0)          AS total_size_webp,
        COALESCE(SUM(downloads), 0)          AS total_downloads,
        COALESCE(SUM(views), 0)              AS total_views,
        COUNT(CASE WHEN uploaded_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) AS uploads_last_7d
      FROM wallpapers
    `);

    const [byCategory] = await pool.query(`
      SELECT
        COALESCE(NULLIF(category,''), 'Uncategorized') AS category,
        COUNT(*)       AS count,
        SUM(downloads) AS downloads,
        SUM(views)     AS views
      FROM wallpapers
      GROUP BY category
      ORDER BY count DESC
    `);

    const [topDownloads] = await pool.query(
      'SELECT id, title, downloads, views FROM wallpapers ORDER BY downloads DESC LIMIT 5'
    );
    const [topViews] = await pool.query(
      'SELECT id, title, downloads, views FROM wallpapers ORDER BY views DESC LIMIT 5'
    );

    res.json({ totals, byCategory, topDownloads, topViews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── View & download tracking (public — no auth needed) ────────────────────────

// Call this from the public wallpaper page to increment view count
app.post('/api/images/:id/view', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query('UPDATE wallpapers SET views = views + 1 WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Use this URL for the "Download" button on the public site
// It increments the download counter then streams the original file
app.get('/api/download/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const [rows] = await pool.query(
      'SELECT filename_original, title FROM wallpapers WHERE id = ?', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    await pool.query('UPDATE wallpapers SET downloads = downloads + 1 WHERE id = ?', [id]);

    const filePath = path.join(UPLOAD_DIR, rows[0].filename_original);
    const ext      = path.extname(rows[0].filename_original);
    const safeName = slugify(rows[0].title) + ext;

    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── Categories ────────────────────────────────────────────────────────────────

app.get('/api/categories', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/categories', requireAuth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  if (name.length > 100) return res.status(400).json({ error: 'Name too long (max 100 chars)' });

  try {
    const [result] = await pool.query('INSERT INTO categories (name) VALUES (?)', [name]);
    res.json({ ok: true, id: result.insertId, name });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Category already exists' });
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/categories/:id', requireAuth, async (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const name = String(req.body.name || '').trim();
  if (!id)   return res.status(400).json({ error: 'Invalid id' });
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 100) return res.status(400).json({ error: 'Name too long (max 100 chars)' });

  try {
    const [result] = await pool.query('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, id, name });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Category name already exists' });
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/categories/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  try {
    const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── Bulk upload (CSV) ─────────────────────────────────────────────────────────

// Download a ready-to-fill CSV template
app.get('/api/bulk-template', requireAuth, (_req, res) => {
  const header = [
    'title', 'image_url', 'tags', 'category',
    'slug', 'alt_text', 'seo_title', 'meta_desc', 'og_title', 'og_description',
  ].join(',');

  const example = [
    '"Mystic Night 4K"',
    '"https://example.com/mystic-night.png"',
    '"dark,fantasy,purple"',
    '"Dark Fantasy"',
    '"mystic-night-4k"',
    '"A dark fantasy anime wallpaper"',
    '"Mystic Night 4K Anime Wallpaper"',
    '"Download this stunning dark fantasy wallpaper in 4K."',
    '"Mystic Night — AnimeWallpaperz"',
    '"Free 4K anime wallpapers at AnimeWallpaperz.in"',
  ].join(',');

  const csv = header + '\n' + example + '\n';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bulk-upload-template.csv"');
  res.send(csv);
});

// Process a CSV file — downloads each image_url, generates WebP + keeps original
app.post('/api/bulk-upload', requireAuth, uploadCsv.single('csv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file provided' });

  let records;
  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    records = parseCsv(content, {
      columns: true,           // use first row as header names
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  } finally {
    fs.unlink(req.file.path, () => {}); // always clean up CSV
  }

  if (!records.length) {
    return res.status(400).json({ error: 'CSV has no data rows' });
  }

  const results = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2; // +2 because row 1 is the header

    if (!row.title || !row.title.trim()) {
      results.push({ row: rowNum, status: 'error', title: row.title || '(empty)', error: 'Missing title' });
      continue;
    }
    if (!row.image_url || !row.image_url.trim()) {
      results.push({ row: rowNum, status: 'error', title: row.title, error: 'Missing image_url' });
      continue;
    }

    const tmpPath = path.join(TEMP_DIR, `bulk-${Date.now()}-${i}`);

    try {
      // Derive a filename from the URL for extension detection
      const urlPath    = new URL(row.image_url).pathname;
      const urlExt     = path.extname(urlPath).toLowerCase() || '.jpg';
      const tmpFile    = tmpPath + urlExt;
      const fakeName   = slugify(row.title) + urlExt;

      await downloadImage(row.image_url, tmpFile);

      const saved = await saveWallpaper(tmpFile, fakeName, {
        title:          row.title,
        tags:           row.tags          || '',
        category:       row.category      || '',
        slug:           row.slug          || '',
        alt_text:       row.alt_text      || '',
        seo_title:      row.seo_title     || '',
        meta_desc:      row.meta_desc     || '',
        og_title:       row.og_title      || '',
        og_description: row.og_description || '',
      });

      results.push({ row: rowNum, status: 'ok', title: row.title, id: saved.id, slug: saved.finalSlug });
    } catch (err) {
      // Clean up temp file if it exists
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
        try { fs.unlinkSync(tmpPath + ext); } catch { /* ignore */ }
      }
      results.push({ row: rowNum, status: 'error', title: row.title, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.status === 'ok').length;
  const failed    = results.filter(r => r.status === 'error').length;

  res.json({ ok: true, total: records.length, succeeded, failed, results });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AnimeWallpaperz server running → http://localhost:${PORT}`);
  console.log(`Admin panel → http://localhost:${PORT}/admin`);
});
