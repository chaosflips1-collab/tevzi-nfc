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

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tevzi.html'));
});

// Demo persons
const persons = [
  { id: 1, firstName: 'Ahmet Seyfi', lastName: 'Yüksel', role: 'Depocu', cardUid: 'CARD_AHMET' },
  { id: 2, firstName: 'Zeki Okan', lastName: 'Kaya', role: 'Boru Ustası', cardUid: 'CARD_ZEKI' }
];

const nfcScans = [];

// DATA FILES
const DATA_DIR = path.join(__dirname, 'data');
const ASSIGN_FILE = path.join(DATA_DIR, 'assignments.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (!fs.existsSync(ASSIGN_FILE)) fs.writeFileSync(ASSIGN_FILE, '[]');
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, JSON.stringify([
  "Çelik Montaj 3. Kat",
  "Makine Bakım - Hat 2",
  "Muhtelif Boru Donatım İşleri",
  "Depo Düzenleme"
], null, 2));

const readAssignments = () => JSON.parse(fs.readFileSync(ASSIGN_FILE));
const writeAssignments = (v) => fs.writeFileSync(ASSIGN_FILE, JSON.stringify(v, null, 2));

const readJobs = () => JSON.parse(fs.readFileSync(JOBS_FILE));
const writeJobs = (v) => fs.writeFileSync(JOBS_FILE, JSON.stringify(v, null, 2));

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------- API'LER --------------------

// Test endpoint
app.get('/api/hello', (req, res) => {
  res.json({ ok: true, msg: "Tevzi NFC server çalışıyor." });
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

// NFC scan
app.post('/api/nfc-scan', (req, res) => {
  const { cardUid, scannedAt } = req.body;

  if (!cardUid || !scannedAt)
    return res.status(400).json({ ok: false, error: "Eksik parametre" });

  const person = persons.find(p => p.cardUid === cardUid);
  if (!person)
    return res.status(404).json({ ok: false, error: "Bu kart kime ait bilinmiyor" });

  const scan = {
    id: nfcScans.length + 1,
    personId: person.id,
    cardUid,
    scannedAt
  };

  nfcScans.push(scan);

  res.json({ ok: true, person, scan });
});

// Today scans
app.get('/api/today-scans', (req, res) => {
  const t = todayStr();
  const today = nfcScans.filter(s => s.scannedAt.startsWith(t));

  const map = {};
  today.forEach(s => {
    if (!map[s.personId]) map[s.personId] = s;
  });

  const out = Object.values(map).map(s => {
    const p = persons.find(x => x.id === s.personId);
    return {
      personId: p.id,
      fullName: p.firstName + " " + p.lastName,
      role: p.role,
      firstScanAt: s.scannedAt
    };
  });

  res.json({ ok: true, data: out });
});

// Persons
app.get('/api/persons', (req, res) => {
  res.json({ ok: true, data: persons });
});

// Assign
app.post('/api/assign', (req, res) => {
  let { personId, jobName, startTime, endTime } = req.body;
  personId = Number(personId);

  if (!personId || !jobName || !startTime || !endTime)
    return res.status(400).json({ ok: false, error: "Eksik parametre" });

  const person = persons.find(p => p.id === personId);
  if (!person)
    return res.status(404).json({ ok: false, error: "Personel yok" });

  const today = todayStr();
  const assigns = readAssignments();

  const already = assigns.some(a =>
    a.personId === personId &&
    a.startTime.startsWith(today)
  );

  if (already)
    return res.status(409).json({ ok: false, error: "Bugün zaten iş atanmış" });

  const nextId = assigns.length ? Math.max(...assigns.map(x => x.id)) + 1 : 1;

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
  const today = todayStr();
  const assigns = readAssignments()
    .filter(a => a.startTime.startsWith(today));

  res.json({ ok: true, data: assigns });
});

// Full report
app.get('/api/assignments', (req, res) => {
  const date = (req.query.date || todayStr()).slice(0, 10);
  const assigns = readAssignments()
    .filter(a => a.startTime.startsWith(date));

  res.json({ ok: true, data: assigns });
});

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Start
app.listen(PORT, () => {
  console.log("Server çalışıyor → PORT:", PORT);
});
