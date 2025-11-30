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

// Demo persons (şimdilik sabit – ileride DB'ye geçireceğiz)
const persons = [
  { id: 1, firstName: 'Okan', lastName: 'Yücel', role: 'Puantör', cardUid: '613D8D24' },
  { id: 2, firstName: 'Ahmet Seyfi', lastName: 'Yüksel', role: 'Depocu', cardUid: 'CARD_AHMET' },
  { id: 3, firstName: 'Zeki Okan', lastName: 'Kaya', role: 'Boru Ustası', cardUid: 'CARD_ZEKI' }
];

// DATA FILES (şimdilik JSON’da kalacak)
const DATA_DIR = path.join(__dirname, 'data');
const ASSIGN_FILE = path.join(DATA_DIR, 'assignments.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const SHIFT_FILE = path.join(DATA_DIR, 'shifts.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (!fs.existsSync(ASSIGN_FILE)) fs.writeFileSync(ASSIGN_FILE, '[]');

if (!fs.existsSync(JOBS_FILE)) {
  fs.writeFileSync(
    JOBS_FILE,
    JSON.stringify([
      'Çelik Montaj 3. Kat',
      'Makine Bakım - Hat 2',
      'Muhtelif Boru Donatım İşleri',
      'Depo Düzenleme'
    ], null, 2)
  );
}

if (!fs.existsSync(SHIFT_FILE)) {
  fs.writeFileSync(
    SHIFT_FILE,
    JSON.stringify({
      dayStart: '07:00',
      dayEnd: '19:00',
      nightStart: '19:00',
      nightEnd: '07:00'
    }, null, 2)
  );
}

const readAssignments = () => JSON.parse(fs.readFileSync(ASSIGN_FILE));
const writeAssignments = (v) => fs.writeFileSync(ASSIGN_FILE, JSON.stringify(v, null, 2));

const readJobs = () => JSON.parse(fs.readFileSync(JOBS_FILE));
const writeJobs = (v) => fs.writeFileSync(JOBS_FILE, JSON.stringify(v, null, 2));

const readShifts = () => JSON.parse(fs.readFileSync(SHIFT_FILE));
const writeShifts = (v) => fs.writeFileSync(SHIFT_FILE, JSON.stringify(v, null, 2));

// Tarih yardımcıları
function todayStrUTC() {
  return new Date().toISOString().slice(0, 10);
}

function todayStrTR() {
  const now = new Date();
  const tr = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return tr.toISOString().slice(0, 10);
}

function toTRDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 3 * 60 * 60 * 1000);
}

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function classifyShift(minutes, cfg) {
  const ds = hhmmToMinutes(cfg.dayStart);
  const de = hhmmToMinutes(cfg.dayEnd);
  const ns = hhmmToMinutes(cfg.nightStart);
  const ne = hhmmToMinutes(cfg.nightEnd);

  if (minutes >= ds && minutes < de) return 'Sabah';
  if (ns <= ne) {
    if (minutes >= ns && minutes < ne) return 'Akşam';
  } else {
    if (minutes >= ns || minutes < ne) return 'Akşam';
  }
  return 'Belirsiz';
}

// ---------------- API’LER --------------------

// Test endpoint
app.get('/api/hello', (req, res) => {
  res.json({ ok: true, msg: 'Tevzi NFC server çalışıyor.' });
});

// DB test
app.get('/api/db-test', async (req, res) => {
  try {
    const count = await prisma.shiftLog.count();
    res.json({ ok: true, shiftLogCount: count });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'DB bağlantı hatası' });
  }
});

// ---------------- NFC / SHIFTLOG (DB) --------------------

// NFC Scan — 500 HATASINI GİDEREN STABİL VERSİYON
app.post('/api/nfc-scan', async (req, res) => {
  try {
    let { cardUid, scannedAt } = req.body;

    if (!cardUid) {
      return res.status(400).json({ ok: false, error: 'cardUid yok' });
    }

    // scannedAt boş veya bozuksa → otomatik üret
    let ts = scannedAt ? new Date(scannedAt) : new Date();
    if (Number.isNaN(ts.getTime())) {
      ts = new Date();
    }

    const person = persons.find((p) => p.cardUid === cardUid);

    if (!person) {
      return res.status(404).json({ ok: false, error: 'Kart tanınmadı' });
    }

    const log = await prisma.shiftLog.create({
      data: {
        personId: person.id,
        type: 'scan',
        shift: '-',
        timestamp: ts
      }
    });

    res.json({
      ok: true,
      person,
      scan: {
        id: log.id,
        personId: person.id,
        cardUid,
        scannedAt: ts.toISOString()
      }
    });

  } catch (err) {
    console.error("NFC HATA:", err);
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Bugünkü özet
app.get('/api/today-scans', async (req, res) => {
  try {
    const today = todayStrUTC();
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(`${today}T23:59:59.999Z`);

    const logs = await prisma.shiftLog.findMany({
      where: { timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' }
    });

    const map = {};
    logs.forEach(log => {
      const t = log.timestamp.toISOString();

      if (!map[log.personId]) {
        map[log.personId] = {
          firstScanAt: t,
          lastScanAt: t,
          scanCount: 1
        };
      } else {
        if (t < map[log.personId].firstScanAt) map[log.personId].firstScanAt = t;
        if (t > map[log.personId].lastScanAt) map[log.personId].lastScanAt = t;
        map[log.personId].scanCount++;
      }
    });

    const out = Object.entries(map).map(([pid, info]) => {
      const p = persons.find((x) => x.id === Number(pid));
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
    }).filter(Boolean);

    res.json({ ok: true, data: out });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Tüm NFC logları
app.get('/api/nfc-logs', async (req, res) => {
  try {
    const logs = await prisma.shiftLog.findMany({ orderBy: { timestamp: 'asc' } });

    const data = logs.map(log => {
      const p = persons.find((x) => x.id === log.personId);
      return {
        id: log.id,
        scannedAt: log.timestamp.toISOString(),
        cardUid: p?.cardUid || null,
        fullName: p ? `${p.firstName} ${p.lastName}` : null,
        role: p?.role || null
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

// Persons
app.get('/api/persons', (req, res) => {
  res.json({ ok: true, data: persons });
});

// Assign (JSON’da kalıyor — ileride DB’ye alınacak)
app.post('/api/assign', (req, res) => {
  let { personId, jobName, startTime, endTime } = req.body;
  personId = Number(personId);

  if (!personId || !jobName || !startTime || !endTime) {
    return res.status(400).json({ ok: false, error: 'Eksik parametre' });
  }

  const person = persons.find((p) => p.id === personId);
  if (!person) return res.status(404).json({ ok: false, error: 'Personel yok' });

  const today = todayStrUTC();
  const assigns = readAssignments();

  const already = assigns.some(
    (a) => a.personId === personId && a.startTime.startsWith(today)
  );

  if (already) {
    return res.status(409).json({ ok: false, error: 'Bugün zaten iş atanmış' });
  }

  const nextId = assigns.length ? Math.max(...assigns.map(a => a.id)) + 1 : 1;

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
  const assigns = readAssignments().filter(a => a.startTime.startsWith(today));
  res.json({ ok: true, data: assigns });
});

// Rapor
app.get('/api/report', async (req, res) => {
  try {
    const date = (req.query.date || todayStrTR()).slice(0, 10);
    const shifts = readShifts();

    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    const logs = await prisma.shiftLog.findMany({
      where: { timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' }
    });

    const enriched = logs
      .map((log) => {
        const iso = log.timestamp.toISOString();
        const tr = toTRDate(iso);
        if (!tr) return null;
        const trDate = tr.toISOString().slice(0, 10);
        return {
          ...log,
          iso,
          tr,
          trDate,
          cardUid: persons.find((p) => p.id === log.personId)?.cardUid || null
        };
      })
      .filter(Boolean)
      .filter((s) => s.trDate === date);

    const byPerson = {};
    enriched.forEach((s) => {
      if (!byPerson[s.personId]) byPerson[s.personId] = [];
      byPerson[s.personId].push(s);
    });

    const rows = [];

    Object.entries(byPerson).forEach(([pid, scans]) => {
      scans.sort((a, b) => a.tr - b.tr);
      const first = scans[0];
      const last = scans[scans.length - 1];

      const p = persons.find((x) => x.id === Number(pid));
      const fullName = p ? `${p.firstName} ${p.lastName}` : "(Bilinmiyor)";
      const role = p?.role || "-";

      const minutes =
        scans.length > 1
          ? Math.round((last.tr.getTime() - first.tr.getTime()) / 60000)
          : 0;

      const shiftName = classifyShift(
        first.tr.getUTCHours() * 60 + first.tr.getUTCMinutes(),
        shifts
      );

      rows.push({
        personId: Number(pid),
        fullName,
        role,
        cardUid: first.cardUid,
        firstScanAt: first.iso,
        lastScanAt: last.iso,
        scanCount: scans.length,
        hasExit: scans.length > 1,
        shift: shiftName,
        workMinutes: minutes
      });
    });

    const summary = {
      totalPersons: rows.length,
      totalScans: enriched.length,
      dayCount: rows.filter(r => r.shift === "Sabah").length,
      nightCount: rows.filter(r => r.shift === "Akşam").length,
      noExitCount: rows.filter(r => !r.hasExit).length
    };

    res.json({ ok: true, date, summary, rows });

  } catch (err) {
    console.error("report error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası" });
  }
});

// Static serve
app.use(express.static(path.join(__dirname, 'public')));

// Start
app.listen(PORT, () => {
  console.log("Server çalışıyor → PORT:", PORT);
});
