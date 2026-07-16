// ============================================================
//  MedTrack LK — scheduler.js
//  C:\Users\sandu\MedTrackLK\scheduler.js
// ============================================================

const cron = require("node-cron");
const { checkAndSendAlert, logger } = require("./alertService");

// ── Reuses the same DB connection setup as server.js ─────────
const mysql = require("mysql2");

const db = mysql.createConnection({
    host:     "localhost",
    user:     "root",
    password: "",
    database: "medtrack_db"
});

db.connect((err) => {
    if (err) {
        logger("ERROR", "Scheduler DB connection failed: " + err.message);
    } else {
        logger("INFO", "Scheduler DB connected ✅");
    }
});

// ── Checks every day at 8:00 AM ───────────────────────────────
cron.schedule("0 8 * * *", () => {
    logger("INFO", "⏰ Daily scheduled check triggered (8:00 AM)");
    checkAndSendAlert(db);
});

logger("INFO", "Scheduler started — daily check at 8:00 AM ✅");

// ⚠️ Removed the line that ran a check on every server start (it was there for testing).
// Now emails are only sent in two cases:
//   1) The daily 8:00 AM cron job (checks the entire inventory)
//   2) When a medicine is added/updated (server.js — checkSingleMedicine, checks only that one medicine)
// Restarting the server no longer triggers an email.