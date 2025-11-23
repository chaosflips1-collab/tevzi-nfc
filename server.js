// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ======================
// ORTA KATMANLAR
// ======================
app.use(cors());
app.use(express.json());


// ======================
// ROOT ROUTE (EN ÜSTE)
// ======================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tevzi.html'));
});


// ======================
// DEMO PERSONEL VERİLERİ
// ======================
const persons = [
  { id: 1, firstName: 'Ahmet Seyfi', lastName: 'Yüksel', role: 'Depocu', cardUid: 'CARD_AHMET' },
  { id: 2, firstName: 'Zeki Okan', lastName: 'Kaya', role: 'Boru Ustası', cardUid: 'CARD_ZEKI' }
];


// NFC RAM KAYITLARI
const nfcScans = [];


// ======================
// KALICI ATAMA DOSYASI
// ======================
const DATA_DIR = path.join(__dirname, 'data');
const ASSIGN_FILE = path.join(DATA_DIR, 'assignments.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(ASSIGN_FILE)) fs.writeFileSync(ASSIGN_FILE, '[]', 'utf8');

function readAssignments() {
  try {
    const raw = fs.readFileSync(ASSIGN_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.log("assignments.json okunamadı:", e);
    return [];
  }
}

function writeAssignments(list) {
  fs.writeFileSync(ASSIGN_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}


// ======================
// API’LER
// ======================

// Test endpoint
app.get('/api/hello', (req, res) => {
  res.json({ ok: true, message: 'Tevzi NFC server çalışıyor.' });
});


// NFC Kart okuma
app.post('/api/nfc-scan', (req, res) => {
  const { cardUid, scannedAt } = req.body;

  if (!cardUid || !scannedAt) {
    return res.status(400).json({ ok: false, error: 'cardUid ve scannedAt zorunlu.' });
  }

  const person = persons.find(p => p.cardUid === cardUid);

  if (!person) {
    return res.status(404).json({ ok: false, error: 'Bu karta bağlı personel bulunamadı.' });
  }

  const scan = {
    id: nfcScans.length + 1,
    personId: person.id,
    cardUid,
    scannedAt,
  };

  nfcScans.push(scan);
  console.log('Yeni NFC kaydı:', scan);

  res.json({
    ok: true,
    person: {
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      role: person.role,
    },
    scan,
  });
});


// Bugün kart okutanlar
app.get('/api/today-scans', (req, res) => {
  const today = todayStr();
  const todayScans = nfcScans.filter(s => s.scannedAt.startsWith(today));

  const unique = {};
  todayScans.forEach(s => unique[s.personId] = s);

  const result = Object.values(unique).map(s => {
    const p = persons.find(x => x.id === s.personId);
    return {
      personId: p.id,
      fullName: `${p.firstName} ${p.lastName}`,
      role: p.role,
      firstScanAt: s.scannedAt
    };
  });

  res.json({ ok: true, data: result });
});


// Tüm personeller
app.get('/api/persons', (req, res) => {
  res.json({ ok: true, data: persons });
});


// ======================
// TEVZİ - İŞ ATAMALARI
// ======================

// Yeni iş atama
app.post('/api/assign', (req, res) => {
  let { personId, jobName, startTime, endTime } = req.body;
  personId = Number(personId);

  if (!personId || !jobName || !startTime || !endTime) {
    return res.status(400).json({ ok: false, error: 'Eksik parametre.' });
  }

  const person = persons.find(p => p.id === personId);
  if (!person) {
    return res.status(404).json({ ok: false, error: 'Personel bulunamadı.' });
  }

  const today = todayStr();
  const assignments = readAssignments();

  const already = assignments.some(a =>
    a.personId === personId &&
    a.startTime.startsWith(today)
  );

  if (already) {
    return res.status(409).json({
      ok: false,
      error: 'Bu personele bugün zaten iş atanmış.'
    });
  }

  const nextId = assignments.length
    ? Math.max(...assignments.map(a => a.id)) + 1
    : 1;

  const assignment = {
    id: nextId,
    personId,
    jobName,
    startTime,
    endTime,
    fullName: `${person.firstName} ${person.lastName}`,
    role: person.role
  };

  assignments.push(assignment);
  writeAssignments(assignments);

  console.log("Yeni iş ataması:", assignment);
  res.json({ ok: true, assignment });
});


// Bugünkü işler
app.get('/api/assignments/today', (req, res) => {
  const today = todayStr();
  const assignments = readAssignments();

  const result = assignments
    .filter(a => a.startTime.startsWith(today))
    .map(a => ({
      id: a.id,
      personId: a.personId,
      fullName: a.fullName,
      role: a.role,
      jobName: a.jobName,
      startTime: a.startTime,
      endTime: a.endTime
    }));

  res.json({ ok: true, data: result });
});


// İş silme
app.delete('/api/assign/:id', (req, res) => {
  const id = Number(req.params.id);
  let assignments = readAssignments();

  const before = assignments.length;
  assignments = assignments.filter(a => a.id !== id);
  const after = assignments.length;

  if (before === after) {
    return res.status(404).json({ ok: false, error: 'Silinecek kayıt bulunamadı.' });
  }

  writeAssignments(assignments);
  res.json({ ok: true });
});


// ======================
// STATİK DOSYALAR (EN SON!)
// ======================
app.use(express.static(path.join(__dirname, 'public')));


// ======================
// SERVER BAŞLAT
// ======================
app.listen(PORT, () => {
  console.log(`Server çalışıyor: http://localhost:${PORT}`);
});
