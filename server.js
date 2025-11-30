// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

// ---------------- PRISMA / POSTGRES ----------------
const prisma = new PrismaClient();

// Uygulama
const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Root route → ana panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tevzi.html'));
});

// Demo persons (şimdilik sabit – ileride DB’ye taşırız)
const persons = [
  { id: 1, firstName: 'Okan',       lastName: 'Yücel',  role: 'Puantör',        cardUid: '613D8D24' },
  { id: 2, firstName: 'Ahmet Seyfi', lastName: 'Yüksel', role: 'Depocu',       cardUid: 'CARD_AHMET' },
  { id: 3, firstName: 'Zeki Okan',   lastName: 'Kaya',   role: 'Boru Ustası',   cardUid: 'CARD_ZEKI' }
];

// DATA FILES (şimdilik JSON’da kalıyor)
const DATA_DIR = path.join(__dirname, 'data');
const ASSIGN_FILE = path.join(DATA_DIR, 'assignments.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const SHIFT_FILE = path.join(DATA_DIR, 'shifts.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (!fs.existsSync(ASSIGN_FILE)) fs.writeFileSync(ASSIGN_FILE, '[]', 'utf8');

if (!fs.existsSync(JOBS_FILE)) {
  fs.writeFileSync(
    JOBS_FILE,
    JSON.stringify(
      [
        'Çelik Montaj 3. Kat',
        'Makine Bakım - Hat 2',
        'Muhtelif Boru Donatım İşleri',
        'Depo Düzenleme'
      ],
      null,
      2
    ),
    'utf8'
  );
}

// Varsayılan vardiya saatleri
if (!fs.existsSync(SHIFT_FILE)) {
  fs.writeFileSync(
    SHIFT_FILE,
    JSON.stringify(
      {
        dayStart: '07:00',
        dayEnd: '19:00',
        nightStart: '19:00',
        nightEnd: '07:00'
      },
      null,
      2
    ),
    'utf8'
  );
}

const readAssignments = () => JSON.parse(fs.readFileSync(ASSIGN_FILE, 'utf8'));
const writeAssignments = (v) =>
  fs.writeFileSync(ASSIGN_FILE, JSON.stringify(v, null, 2), 'utf8');

const readJobs = () => JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
const writeJobs = (v) =>
  fs.writeFileSync(JOBS_FILE, JSON.stringify(v, null, 2), 'utf8');

const readShifts = () => JSON.parse(fs.readFileSync(SHIFT_FILE, 'utf8'));
const writeShifts = (v) =>
  fs.writeFileSync(SHIFT_FILE, JSON.stringify(v, null, 2), 'utf8');

// Bugünün UTC tarihi (yyyy-mm-dd)
function todayStrUTC() {
  return new Date().toISOString().slice(0, 10);
}

// Bugünün TR tarihi (yyyy-mm-dd)
function todayStrTR() {
  const now = new Date();
  const tr = new Date(now.getTime() + 3 * 60 * 60 * 1000); // +3 saat
  return tr.toISOString().slice(0, 10);
}

// ISO zamanı TR saatine çevir
function toTRDate(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 3 * 60 * 60 * 1000); // +3 saat
}

// TR tarihi (yyyy-mm-dd) döndür
function trDateFromIso(isoString) {
  const d = toTRDate(isoString);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function hhmmToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

function classifyShift(minutes, cfg) {
  const dayStart = hhmmToMinutes(cfg.dayStart);
  const dayEnd = hhmmToMinutes(cfg.dayEnd);
  const nightStart = hhmmToMinutes(cfg.nightStart);
  const nightEnd = hhmmToMinutes(cfg.nightEnd);

  if ([dayStart, dayEnd, nightStart, nightEnd].some((x) => Number.isNaN(x))) {
    return 'Belirsiz';
  }

  // Gündüz (normal aralık)
  if (dayStart <= dayEnd && minutes >= dayStart && minutes < dayEnd) {
    return 'Sabah';
  }

  // Gece vardiyası kesişmiyorsa
  if (nightStart <= nightEnd) {
    if (minutes >= nightStart && minutes < nightEnd) return 'Akşam';
  } else {
    // Gece vardiyası geceye taşıyor (ör: 19:00–07:00)
    if (minutes >= nightStart || minutes < nightEnd) return 'Akşam';
  }

  return 'Belirsiz';
}

// ---------------- API'LER --------------------

// Test endpoint
app.get('/api/hello', (req, res) => {
  res.json({ ok: true, msg: 'Tevzi NFC server çalışıyor.' });
});

// DB test endpoint (PostgreSQL bağlantısı kontrol)
app.get('/api/db-test', async (req, res) => {
  try {
    const count = await prisma.shiftLog.count();
    res.json({ ok: true, shiftLogCount: count });
  } catch (err) {
    console.error('DB test error:', err);
    res.status(500).json({ ok: false, error: 'DB bağlantı hatası' });
  }
});

// JOBS
app.get('/api/jobs', (req, res) => {
  res.json({ ok: true, data: readJobs() });
});

app.post('/api/jobs', (req, res) => {
  const jobs = readJobs();
  const name = (req.body.jobName || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'jobName zorunlu' });

  if (!jobs.includes(name)) jobs.push(name);
  writeJobs(jobs);

  res.json({ ok: true, data: jobs });
});

// VARDİYA AYARLARI
app.get('/api/shifts', (req, res) => {
  res.json({ ok: true, data: readShifts() });
});

app.post('/api/shifts', (req, res) => {
  const { dayStart, dayEnd, nightStart, nightEnd } = req.body || {};

  const isValidTime = (t) =>
    typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

  if (
    !isValidTime(dayStart) ||
    !isValidTime(dayEnd) ||
    !isValidTime(nightStart) ||
    !isValidTime(nightEnd)
  ) {
    return res.status(400).json({
      ok: false,
      error: 'Saat formatı HH:MM olmalı (ör: 07:00, 19:00)'
    });
  }

  const cfg = { dayStart, dayEnd, nightStart, nightEnd };
  writeShifts(cfg);

  res.json({ ok: true, data: cfg });
});

// ---------------- NFC / SHIFTLOG (PostgreSQL) --------------------

// NFC scan (giriş & çıkış – ARTIK DB'YE YAZIYOR)
app.post('/api/nfc-scan', async (req, res) => {
  try {
    const { cardUid, scannedAt } = req.body;

    if (!cardUid || !scannedAt) {
      return res.status(400).json({ ok: false, error: 'Eksik parametre' });
    }

    const person = persons.find((p) => p.cardUid === cardUid);
    if (!person) {
      return res
        .status(404)
        .json({ ok: false, error: 'Bu kart kime ait bilinmiyor' });
    }

    const ts = new Date(scannedAt);
    if (Number.isNaN(ts.getTime())) {
      return res.status(400).json({ ok: false, error: 'Geçersiz scannedAt' });
    }

    // ShiftLog tablosuna kaydet
    const log = await prisma.shiftLog.create({
      data: {
        personId: person.id,
        type: 'scan',
        shift: '-', // şimdilik boş, raporda hesaplayacağız
        timestamp: ts
      }
    });

    const scan = {
      id: log.id,
      personId: person.id,
      cardUid,
      scannedAt: ts.toISOString()
    };

    console.log('Gelen NFC body:', { cardUid, scannedAt });

    res.json({ ok: true, person, scan });
  } catch (err) {
    console.error('NFC Scan error:', err);
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Bugünkü özet (giriş-çıkış) – sol sütun & anlık liste için
app.get('/api/today-scans', async (req, res) => {
  try {
    const today = todayStrUTC(); // yyyy-mm-dd (UTC)
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(`${today}T23:59:59.999Z`);

    const logs = await prisma.shiftLog.findMany({
      where: {
        timestamp: {
          gte: start,
          lte: end
        }
      },
      orderBy: { timestamp: 'asc' }
    });

    // Kişi bazlı grupla
    const map = {};
    logs.forEach((log) => {
      const scannedAt = log.timestamp.toISOString();
      if (!map[log.personId]) {
        map[log.personId] = {
          firstScanAt: scannedAt,
          lastScanAt: scannedAt,
          scanCount: 1
        };
      } else {
        if (scannedAt < map[log.personId].firstScanAt) {
          map[log.personId].firstScanAt = scannedAt;
        }
        if (scannedAt > map[log.personId].lastScanAt) {
          map[log.personId].lastScanAt = scannedAt;
        }
        map[log.personId].scanCount++;
      }
    });

    const out = Object.entries(map)
      .map(([personId, info]) => {
        const p = persons.find((x) => x.id === Number(personId));
        if (!p) return null;

        return {
          personId: p.id,
          fullName: `${p.firstName} ${p.lastName}`,
          role: p.role,
          firstScanAt: info.firstScanAt,
          lastScanAt: info.lastScanAt,
          hasExit: info.scanCount > 1,
          scanCount: info.scanCount
        };
      })
      .filter(Boolean);

    res.json({ ok: true, data: out });
  } catch (err) {
    console.error('today-scans error:', err);
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Ham NFC logları (tüm okutmalar sıralı)
app.get('/api/nfc-logs', async (req, res) => {
  try {
    const logs = await prisma.shiftLog.findMany({
      orderBy: { timestamp: 'asc' }
    });

    const data = logs.map((log) => {
      const p = persons.find((x) => x.id === log.personId);
      return {
        id: log.id,
        cardUid: p ? p.cardUid : null,
        scannedAt: log.timestamp.toISOString(),
        personId: log.personId,
        fullName: p ? `${p.firstName} ${p.lastName}` : null,
        role: p ? p.role : null
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('nfc-logs error:', err);
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Persons (şimdilik statik)
app.get('/api/persons', (req, res) => {
  res.json({ ok: true, data: persons });
});

// Assign (JSON dosyasına yazmaya devam – ileride DB’ye taşınabilir)
app.post('/api/assign', (req, res) => {
  let { personId, jobName, startTime, endTime } = req.body;
  personId = Number(personId);

  if (!personId || !jobName || !startTime || !endTime) {
    return res.status(400).json({ ok: false, error: 'Eksik parametre' });
  }

  const person = persons.find((p) => p.id === personId);
  if (!person) {
    return res.status(404).json({ ok: false, error: 'Personel yok' });
  }

  const today = todayStrUTC();
  const assigns = readAssignments();

  const already = assigns.some(
    (a) => a.personId === personId && a.startTime.startsWith(today)
  );

  if (already) {
    return res
      .status(409)
      .json({ ok: false, error: 'Bugün zaten iş atanmış' });
  }

  const nextId = assigns.length ? Math.max(...assigns.map((x) => x.id)) + 1 : 1;

  const newObj = {
    id: nextId,
    personId,
    jobName,
    startTime,
    endTime,
    fullName: `${person.firstName} ${person.lastName}`,
    role: person.role
  };

  assigns.push(newObj);
  writeAssignments(assigns);

  res.json({ ok: true, assignment: newObj });
});

// Today's assignments
app.get('/api/assignments/today', (req, res) => {
  const today = todayStrUTC();
  const assigns = readAssignments().filter((a) =>
    a.startTime.startsWith(today)
  );

  res.json({ ok: true, data: assigns });
});

// Full report (seçili tarih için – TR tarihine göre, DB'den okuyor)
app.get('/api/report', async (req, res) => {
  try {
    const date = (req.query.date || todayStrTR()).slice(0, 10);
    const shifts = readShifts();

    // İlgili tarihe yakın tüm logları çek (UTC)
    const startUtc = new Date(`${date}T00:00:00.000Z`);
    const endUtc = new Date(`${date}T23:59:59.999Z`);

    const logs = await prisma.shiftLog.findMany({
      where: {
        timestamp: {
          gte: startUtc,
          lte: endUtc
        }
      },
      orderBy: { timestamp: 'asc' }
    });

    // TR saatine göre zenginleştir
    const enriched = logs
      .map((log) => {
        const iso = log.timestamp.toISOString();
        const tr = toTRDate(iso);
        if (!tr) return null;
        const trDate = tr.toISOString().slice(0, 10);
        return {
          ...log,
          cardUid: (persons.find((p) => p.id === log.personId) || {}).cardUid,
          iso,
          tr,
          trDate
        };
      })
      .filter(Boolean)
      .filter((s) => s.trDate === date);

    // Kişi bazlı grupla
    const byPerson = {};
    enriched.forEach((s) => {
      if (!byPerson[s.personId]) {
        byPerson[s.personId] = [];
      }
      byPerson[s.personId].push(s);
    });

    const rows = [];

    Object.entries(byPerson).forEach(([personIdStr, scans]) => {
      const personId = Number(personIdStr);
      scans.sort((a, b) => a.tr - b.tr);

      const first = scans[0];
      const last = scans[scans.length - 1];

      const p = persons.find((x) => x.id === personId);
      const fullName = p ? `${p.firstName} ${p.lastName}` : '(Bilinmiyor)';
      const role = p ? p.role : '-';

      const minutes =
        scans.length > 1
          ? Math.max(
              0,
              Math.round((last.tr.getTime() - first.tr.getTime()) / 60000)
            )
          : 0;

      const firstMinutes =
        first.tr.getUTCHours() * 60 + first.tr.getUTCMinutes();
      const shiftName = classifyShift(firstMinutes, shifts);

      rows.push({
        personId,
        fullName,
        role,
        cardUid: first.cardUid || null,
        firstScanAt: first.iso,
        lastScanAt: last.iso,
        hasExit: scans.length > 1,
        scanCount: scans.length,
        shift: shiftName,
        workMinutes: minutes
      });
    });

    const summary = {
      totalPersons: rows.length,
      totalScans: enriched.length,
      dayCount: rows.filter((r) => r.shift === 'Sabah').length,
      nightCount: rows.filter((r) => r.shift === 'Akşam').length,
      noExitCount: rows.filter((r) => !r.hasExit).length
    };

    res.json({ ok: true, date, summary, rows });
  } catch (err) {
    console.error('report error:', err);
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Full assignments by date (JSON’dan okumaya devam)
app.get('/api/assignments', (req, res) => {
  const date = (req.query.date || todayStrUTC()).slice(0, 10);
  const assigns = readAssignments().filter((a) =>
    a.startTime.startsWith(date)
  );

  res.json({ ok: true, data: assigns });
});

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Start
app.listen(PORT, () => {
  console.log('Server çalışıyor → PORT:', PORT);
});
