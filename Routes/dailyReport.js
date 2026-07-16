const express = require("express");
const mysql = require("mysql2");
const router = express.Router();

// ── DB Connection ───────────────────────────────────────────────
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "medtrack_db"
});

db.connect((err) => {
    if (err) {
        console.log("Daily report module: DB connection failed ❌", err.message);
    } else {
        console.log("Daily report module: DB connected ✅");
    }
});

// ── GET /api/daily-report?date=YYYY-MM-DD ──────────────────────────
// Defaults to today if no date given. Requires the user to be logged in.
router.get("/daily-report", (req, res) => {

    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: "Not logged in" });
    }

    // Validate date param (basic YYYY-MM-DD check), fallback to today
    const dateParam = req.query.date;
    const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || "");
    const targetDate = isValidDate ? dateParam : null; // null = use CURDATE() in SQL

    const dateFilter = targetDate ? "DATE(saleDate) = ?" : "DATE(saleDate) = CURDATE()";
    const dateParams = targetDate ? [targetDate] : [];

    // Per-medicine breakdown for the day
    const breakdownSql = `
        SELECT medName,
               SUM(quantity) AS qtySold,
               SUM(total) AS revenue,
               COUNT(*) AS transactions
        FROM sales
        WHERE ${dateFilter}
        GROUP BY medName
        ORDER BY revenue DESC
    `;

    db.query(breakdownSql, dateParams, (err, rows) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ success: false, error: err.message });
        }

        const totalRevenue = rows.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
        const totalQuantitySold = rows.reduce((sum, r) => sum + Number(r.qtySold || 0), 0);
        const totalTransactions = rows.reduce((sum, r) => sum + Number(r.transactions || 0), 0);
        const topSeller = rows.length > 0 ? rows[0].medName : null;

        res.json({
            success: true,
            date: targetDate || new Date().toISOString().slice(0, 10),
            totalRevenue: Number(totalRevenue.toFixed(2)),
            totalQuantitySold,
            totalTransactions,
            uniqueMedicinesSold: rows.length,
            topSeller,
            items: rows.map(r => ({
                medName: r.medName,
                qtySold: Number(r.qtySold),
                revenue: Number(Number(r.revenue).toFixed(2)),
                transactions: Number(r.transactions)
            }))
        });
    });
});

module.exports = router;