/**
 * WLI telemetry backend
 * ----------------------
 * Receives readings POSTed by each coach's MPU (STM32 + Quectel EC200U over
 * LTE/e-SIM) and serves the latest-per-coach snapshot to the dashboard page.
 *
 * Deploy anywhere that gives you a public HTTPS URL (Render, Railway, Fly.io,
 * a VM behind nginx + certbot, etc). The EC200U needs a real internet-facing
 * HTTPS endpoint — it cannot reach a page open only in your browser.
 *
 * Run locally:
 *   npm install
 *   TELEMETRY_TOKEN=changeme node server.js
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'))); // serves public/index.html at "/"

const TOKEN = process.env.TELEMETRY_TOKEN || 'changeme';
const PORT = process.env.PORT || 8080;

// In-memory store: mac_id -> latest reading. Swap for a real DB for production.
const latestByCoach = new Map();

function requireToken(req, res, next) {
  const auth = req.get('authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (provided !== TOKEN) return res.status(401).json({ error: 'invalid or missing token' });
  next();
}

// --- Device -> server -----------------------------------------------------
// Matches spec clause 6.8: HTTPS + token auth, JSON body, one push per
// 15-minute cycle (or immediately once connectivity returns).
app.post('/api/telemetry', requireToken, (req, res) => {
  const b = req.body || {};
  if (!b.mac_id || !b.coach_number) {
    return res.status(400).json({ error: 'mac_id and coach_number are required' });
  }

  const reading = {
    mac_id: String(b.mac_id),
    coach_number: String(b.coach_number),
    water_level_percent: clampPct(b.water_level_percent),
    battery_voltage: numOrNull(b.battery_voltage),
    latitude: numOrNull(b.latitude),
    longitude: numOrNull(b.longitude),
    timestamp: b.timestamp ? new Date(b.timestamp).toISOString() : new Date().toISOString(),
    low_water_alert: clampPct(b.water_level_percent) !== null && clampPct(b.water_level_percent) < 40,
  };

  latestByCoach.set(reading.mac_id, reading);
  res.status(201).json({ ok: true });
});

// --- Server -> dashboard ----------------------------------------------------
// Public read (no token) since the dashboard is served from this same site.
// Put this behind your own auth/VPN if the data shouldn't be publicly viewable.
app.get('/api/telemetry', (req, res) => {
  res.json({ coaches: Array.from(latestByCoach.values()) });
});

app.get('/health', (req, res) => res.json({ ok: true, coaches: latestByCoach.size }));

function clampPct(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}
function numOrNull(v) {
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

app.listen(PORT, () => console.log(`WLI telemetry server listening on :${PORT}`));
