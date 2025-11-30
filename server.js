// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Root route → ana panel
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tevzi.html'));
});

// Demo persons (şimdilik sabit)
const persons = [
  { id: 1, firstName: 'Okan',       lastName: 'Yücel', role: 'Puantör',        cardUid: '613D8D24' },
  { id: 2, firstName: 'Ahmet Seyfi', lastName: 'Yüksel', role: 'Depocu',     cardUid: 'CARD_AHMET' },
  { id: 3, firstName: 'Zeki Okan',   lastName: 'Kaya',   role: 'Boru Ustası', cardUid: 'CARD_ZEKI' }
];

// NFC okutma logları (RAM’de)
const nfcScans = [];

// DATA FILES
const DATA_DIR = path.join(__dirname, 'data');
const ASSIGN_FILE = path.join(DATA_DIR, 'assignments.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const SHIFT_FILE = path.join(DATA_DIR, 'shifts.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (!fs.existsSync(ASSIGN_FILE)) fs.writeFileSync(ASSIGN_FILE, '[]');

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
    )
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
    )
  );
}

const readAssignments = () => JSON.parse(fs.readFileSync(ASSIGN_FILE));
const writeAssignments = (v) =>
  fs.writeFileSync(ASSIGN_FILE, JSON.stringify(v, null, 2));

const readJobs = () => JSON.parse(fs.readFileSync(JOBS_FILE));
const writeJobs = (v) =>
  fs.writeFileSync(JOBS_FILE, JSON.stringify(v, null, 2));

const readShifts = () => JSON.parse(fs.readFileSync(SHIFT_FILE));
const writeShifts = (v) =>
  fs.writeFileSync(SHIFT_FILE, JSON.stringify(v, null, 2));

// Bugünün UTC tarihi (yyyy-mm-dd) – bazı yerlerde kullanıyoruz
function todayStrUTC() {
  return new Date().toISOString().slice(0, 10);
}

// Bugünün TR tarihi (yyyy-mm-dd) – raporlarda bunu baz alıyoruz
function todayStrTR() {
  const now = new Date();
  const tr = new Date(now.getTime() + 3 * 60 * 60 * 1000); // +3 saat
  return tr.toISOString().slice(0, 10);
}

// ISO zamanı TR saatine çeviren yardımcı (Date objesi döndürür)
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

  if (
    [dayStart, dayEnd, nightStart, nightEnd].some((x) => Number.isNaN(x))
  ) {
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

// NFC scan (giriş & çıkış – ham log tutuluyor)
app.post('/api/nfc-scan', (req, res) => {
  const { cardUid, scannedAt } = req.body;

  if (!cardUid || !scannedAt) {
    return res.status(400).json({ ok: false, error: 'Eksik parametre' });
  }

  const person = persons.find((p) => p.cardUid === cardUid);
  if (!person) {
    return res.status(404).json({ ok: false, error: 'Bu kart kime ait bilinmiyor' });
  }

  const scan = {
    id: nfcScans.length + 1,
    personId: person.id,
    cardUid,
    scannedAt // ISO (genelde UTC) – panelde TR’ye çeviriyoruz
  };

  nfcScans.push(scan);

  console.log('Gelen NFC body:', { cardUid, scannedAt });

  res.json({ ok: true, person, scan });
});

// Bugünkü özet (giriş-çıkış) – sol sütun & anlık liste için
app.get('/api/today-scans', (req, res) => {
  const t = todayStrUTC(); // burada UTC güne bakıyoruz

  // Bugünkü tüm okutmalar
  const today = nfcScans.filter((s) => s.scannedAt.startsWith(t));

  // Kişi kişi gruplama
  const map = {};
  today.forEach((s) => {
    if (!map[s.personId]) {
      map[s.personId] = {
        firstScanAt: s.scannedAt,
        lastScanAt: s.scannedAt,
        scanCount: 1
      };
    } else {
      if (s.scannedAt < map[s.personId].firstScanAt) {
        map[s.personId].firstScanAt = s.scannedAt;
      }
      if (s.scannedAt > map[s.personId].lastScanAt) {
        map[s.personId].lastScanAt = s.scannedAt;
      }
      map[s.personId].scanCount++;
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
        firstScanAt: info.firstScanAt, // giriş (ISO)
        lastScanAt: info.lastScanAt, // çıkış (ISO)
        hasExit: info.scanCount > 1,
        scanCount: info.scanCount
      };
    })
    .filter(Boolean);

  res.json({ ok: true, data: out });
});

// Ham NFC logları (tüm okutmalar sıralı)
app.get('/api/nfc-logs', (req, res) => {
  const data = nfcScans.map((s) => {
    const p = persons.find((x) => x.id === s.personId);
    return {
      id: s.id,
      cardUid: s.cardUid,
      scannedAt: s.scannedAt,
      personId: s.personId,
      fullName: p ? `${p.firstName} ${p.lastName}` : null,
      role: p ? p.role : null
    };
  });

  res.json({ ok: true, data });
});

// Persons
app.get('/api/persons', (req, res) => {
  res.json({ ok: true, data: persons });
});

// Assign
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

// Full report (seçili tarih için – TR tarihine göre)
app.get('/api/report', (req, res) => {
  const date = (req.query.date || todayStrTR()).slice(0, 10);
  const shifts = readShifts();

  // Seçilen TR tarihine göre filtrele
  const enriched = nfcScans
    .map((s) => {
      const tr = toTRDate(s.scannedAt);
      if (!tr) return null;
      const trDate = tr.toISOString().slice(0, 10);
      return {
        ...s,
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
      cardUid: first.cardUid,
      firstScanAt: first.scannedAt, // ISO
      lastScanAt: last.scannedAt, // ISO
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
});

// Full assignments by date (şimdilik dokunmuyoruz)
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
