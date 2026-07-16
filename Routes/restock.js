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
        console.log("Restock module: DB connection failed ❌", err.message);
    } else {
        console.log("Restock module: DB connected ✅");
    }
});

// ── GET /api/restock-forecast?days=N ───────────────────────────────
// Matches the exact shape chatbot.html expects:
//   { periodDays, forecast: [ { name, quantity, dailyRate, daysUntilStockout } ] }
router.get("/restock-forecast", (req, res) => {

    const periodDays = parseInt(req.query.days, 10) > 0 ? parseInt(req.query.days, 10) : 30;

    const medicinesSql = "SELECT medName, quantity FROM medicines";

    db.query(medicinesSql, (err, medicines) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ success: false, error: err.message });
        }

        const salesSql = `
            SELECT medName, SUM(quantity) AS totalSold
            FROM sales
            WHERE saleDate >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY medName
        `;

        db.query(salesSql, [periodDays], (err2, salesRows) => {
            if (err2) {
                console.log(err2);
                return res.status(500).json({ success: false, error: err2.message });
            }

            const salesMap = {};
            salesRows.forEach(row => {
                salesMap[row.medName] = Number(row.totalSold) || 0;
            });

            const forecast = medicines.map(med => {
                const quantity = Number(med.quantity) || 0;
                const soldInWindow = salesMap[med.medName] || 0;
                const dailyRate = Number((soldInWindow / periodDays).toFixed(2));

                let daysUntilStockout;
                if (dailyRate > 0) {
                    daysUntilStockout = Math.floor(quantity / dailyRate);
                } else {
                    daysUntilStockout = null; // no sales in this window -> can't predict
                }

                return {
                    name: med.medName,
                    quantity,
                    dailyRate,
                    daysUntilStockout
                };
            });

            res.json({
                success: true,
                periodDays,
                forecast
            });
        });
    });
});

module.exports = router;