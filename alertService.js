// ============================================================
//  MedTrack LK — alertService.js
// ============================================================

const nodemailer = require("nodemailer");
const fs         = require("fs");
const path       = require("path");

const ADMIN_EMAIL = "saduseww@gmail.com";

const LOG_PATH = path.join(__dirname, "logs", "medtrack.log");
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

function logger(type, message) {
    const line = `[${new Date().toISOString()}] [${type}] ${message}`;
    console.log(line);
    fs.appendFileSync(LOG_PATH, line + "\n");
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "saduseww@gmail.com",
        pass: "fdqd oopu wfku gyaw",
    },
});

function writeStatusFile(count, low, expired, soon, extra) {
    const statusFile = path.join(__dirname, "logs", "email_status.json");
    fs.writeFileSync(statusFile, JSON.stringify({
        count,
        sentAt: new Date().toISOString(),
        low,
        expired,
        soon,
        ...extra
    }));
}

// ── Daily 8 AM check — checks the entire inventory ───────────
function checkAndSendAlert(db) {
    logger("INFO", "Inventory check started...");

    db.query("SELECT * FROM medicines", (err, medicines) => {
        if (err) {
            logger("ERROR", "DB query failed: " + err.message);
            return;
        }

        const today   = new Date();
        const limit30 = new Date(today.getTime() + 30 * 86400000);

        const lowStock     = medicines.filter(m => Number(m.quantity) <= 20);
        const expired      = medicines.filter(m => new Date(m.expiryDate) < today);
        const expiringSoon = medicines.filter(m => {
            const d = new Date(m.expiryDate);
            return d >= today && d <= limit30;
        });

        logger("INFO", `Total: ${medicines.length} | LowStock: ${lowStock.length} | Expired: ${expired.length} | ExpiringSoon: ${expiringSoon.length}`);

        if (lowStock.length)     logger("WARN", "Low Stock: "     + lowStock.map(m => m.medName).join(", "));
        if (expired.length)      logger("WARN", "Expired: "       + expired.map(m => m.medName).join(", "));
        if (expiringSoon.length) logger("WARN", "Expiring Soon: " + expiringSoon.map(m => m.medName).join(", "));

        if (!lowStock.length && !expired.length && !expiringSoon.length) {
            logger("INFO", "All medicines OK — no email sent.");
            return;
        }

        const html = buildEmail(lowStock, expired, expiringSoon);

        transporter.sendMail({
            from:    `"MedTrack LK" <saduseww@gmail.com>`,
            to:      ADMIN_EMAIL,
            subject: `⚠️ MedTrack Alert — ${lowStock.length + expired.length + expiringSoon.length} Issues Found`,
            html,
        }, (err2) => {
            if (err2) {
                logger("ERROR", "Email failed: " + err2.message);
            } else {
                logger("INFO", "Alert email sent to " + ADMIN_EMAIL + " ✅");
                writeStatusFile(
                    lowStock.length + expired.length + expiringSoon.length,
                    lowStock.length, expired.length, expiringSoon.length
                );
            }
        });
    });
}

// ── When a medicine is added/updated — check only that single medicine ──
// Pass the medicine object straight from req.body: { medName, batchNo, quantity, expiryDate }
function checkSingleMedicine(medicine) {
    logger("INFO", `Checking single medicine after add/update: ${medicine.medName}`);

    const today   = new Date();
    const limit30 = new Date(today.getTime() + 30 * 86400000);
    const expDate = new Date(medicine.expiryDate);

    if (isNaN(expDate)) {
        logger("WARN", `Invalid expiryDate for ${medicine.medName} — skipping alert check.`);
        return;
    }

    const lowStock     = Number(medicine.quantity) <= 20 ? [medicine] : [];
    const expired       = expDate < today ? [medicine] : [];
    const expiringSoon   = (expDate >= today && expDate <= limit30) ? [medicine] : [];

    if (!lowStock.length && !expired.length && !expiringSoon.length) {
        logger("INFO", `${medicine.medName} is OK — no email sent.`);
        return;
    }

    const html = buildEmail(lowStock, expired, expiringSoon);

    transporter.sendMail({
        from:    `"MedTrack LK" <saduseww@gmail.com>`,
        to:      ADMIN_EMAIL,
        subject: `⚠️ MedTrack Alert — "${medicine.medName}" needs attention`,
        html,
    }, (err2) => {
        if (err2) {
            logger("ERROR", "Email failed: " + err2.message);
        } else {
            logger("INFO", `Alert email sent for ${medicine.medName} ✅`);
            writeStatusFile(
                lowStock.length + expired.length + expiringSoon.length,
                lowStock.length, expired.length, expiringSoon.length,
                { medName: medicine.medName, trigger: "add/update" }
            );
        }
    });
}

function buildEmail(lowStock, expired, expiringSoon) {
    function table(title, color, rows) {
        if (!rows.length) return "";
        return `
        <h3 style="color:${color};margin:20px 0 8px">${title}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr style="background:${color}22">
                <th style="padding:8px;text-align:left;border:1px solid #ddd">Medicine</th>
                <th style="padding:8px;text-align:left;border:1px solid #ddd">Batch No</th>
                <th style="padding:8px;text-align:left;border:1px solid #ddd">Qty</th>
                <th style="padding:8px;text-align:left;border:1px solid #ddd">Expiry Date</th>
            </tr>
            ${rows.map(m => `
            <tr>
                <td style="padding:8px;border:1px solid #ddd">${m.medName}</td>
                <td style="padding:8px;border:1px solid #ddd">${m.batchNo || "—"}</td>
                <td style="padding:8px;border:1px solid #ddd">${m.quantity}</td>
                <td style="padding:8px;border:1px solid #ddd">${new Date(m.expiryDate).toLocaleDateString("en-GB")}</td>
            </tr>`).join("")}
        </table>`;
    }

    return `
    <div style="font-family:Arial,sans-serif;max-width:650px;margin:auto">
        <div style="background:#1e40af;padding:20px 30px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0">🏥 MedTrack LK — Inventory Alert</h2>
            <p style="color:#bfdbfe;margin:4px 0 0">${new Date().toDateString()}</p>
        </div>
        <div style="background:#fff;padding:24px 30px;border-radius:0 0 10px 10px;border:1px solid #e5e7eb">
    <p>Hello Admin,<br>Please review the following medicines that require your attention:</p>

    ${table("⚠️ Low Stock (20 or Less)", "#f97316", lowStock)}

    ${table("🚫 Expired Medicines", "#dc2626", expired)}

    ${table("⏳ Expiring Within 30 Days", "#ca8a04", expiringSoon)}

    <p style="color:#9ca3af;font-size:12px;margin-top:24px">
        This is an automated alert from <strong>MedTrack LK</strong>.<br>
        Please review your inventory and take the necessary action.
    </p>
</div>
    </div>`;
}

module.exports = { checkAndSendAlert, checkSingleMedicine, logger };