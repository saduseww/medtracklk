const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const mysql = require("mysql2");
const session = require("express-session");
const fs = require("fs");

// ── SECTION A ────────────────────────────────────────────────────
//  Add these lines near the top of server.js,
//  right after your existing requires (bodyParser, fs, etc.)
// ─────────────────────────────────────────────────────────────────

const multer = require("multer");

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, "public", "uploads", "medicines");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, "med_" + Date.now() + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        // If no real file was selected (empty filename), skip silently
        // instead of throwing — this happens when editing a medicine
        // without changing its image.
        if (!file.originalname) {
            return cb(null, false);
        }

        const allowed = /jpeg|jpg|png|webp|gif/;
        const ok = allowed.test(file.mimetype) &&
                   allowed.test(path.extname(file.originalname).toLowerCase());
        ok ? cb(null, true) : cb(new Error("Images only!"));
    }
});
// ── check a single medicine when it's added/updated ──────────
const { checkSingleMedicine } = require("./alertService");

app.use(session({
    secret: "medtrack_secret",
    resave: false,
    saveUninitialized: true
}));

// MySQL Connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "medtrack_db"
});

// Connect Database
db.connect((err) => {
    if (err) {
        console.log("Database Connection Failed ❌");
    } else {
        console.log("Database Connected ✅");
    }
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── SESSION GUARD MIDDLEWARE ─────────────────────────────────
function requireLogin(req, res, next) {
    if (!req.session.user) {
        // If it's a fetch/AJAX request, return JSON instead of redirect
        if (req.headers['accept'] && req.headers['accept'].includes('application/json')
            || req.headers['content-type'] && req.headers['content-type'].includes('urlencoded')
            || req.xhr) {
            return res.status(401).json({ success: false, error: "Not logged in" });
        }
        return res.redirect("/login.html");
    }
    next();
}

app.use("/api", require("./routes/restock"));
app.use("/api", require("./routes/dailyReport"));

// ── ROOT ────────────────────────────────────────────────────
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ── LOGIN ───────────────────────────────────────────────────
app.post("/login", (req, res) => {

    const username = req.body.username;
    const password = req.body.password;

    const sql = "SELECT * FROM users WHERE username=? AND password=?";

    db.query(sql, [username, password], (err, results) => {

        if (err) {
            res.send("Error ❌");
            return;
        }

        if (results.length > 0) {

            const user = results[0];

            req.session.user = {
                username: user.username,
                role: user.role
            };

            if (user.role === "admin") {
                res.redirect("/dashboard.html");
            } else {
                res.redirect("/staff.html");
            }

        } else {
            res.redirect("/login.html?error=true");
        }

    });

});

// ── SECTION B ────────────────────────────────────────────────────


app.post("/addMedicine", requireLogin, upload.single("image"), (req, res) => {

    const { medName, batchNo, quantity, expiryDate, buyPrice, sellPrice } = req.body;

    const imageUrl = req.file
        ? "/uploads/medicines/" + req.file.filename
        : null;

    const sql = `
        INSERT INTO medicines
        (medName, batchNo, quantity, expiryDate, buyPrice, sellPrice, imageUrl)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [medName, batchNo, quantity, expiryDate, buyPrice, sellPrice, imageUrl], (err) => {
        if (err) {
            console.log(err);
            return res.json({ success: false, error: err.message });
        }
        checkSingleMedicine({ medName, batchNo, quantity, expiryDate });
        res.json({ success: true, imageUrl });
    });
});


app.post("/updateMedicine", requireLogin, upload.single("image"), (req, res) => {

    const { id, medName, batchNo, quantity, expiryDate, buyPrice, sellPrice } = req.body;

    if (req.file) {
        const imageUrl = "/uploads/medicines/" + req.file.filename;

        const sql = `
            UPDATE medicines
            SET medName=?, batchNo=?, quantity=?, expiryDate=?, buyPrice=?, sellPrice=?, imageUrl=?
            WHERE id=?
        `;

        db.query(sql, [medName, batchNo, quantity, expiryDate, buyPrice, sellPrice, imageUrl, id], (err) => {
            if (err) {
                console.log(err);
                return res.json({ success: false, error: err.message });
            }
            checkSingleMedicine({ medName, batchNo, quantity, expiryDate });
            res.json({ success: true, imageUrl });
        });

    } else {
        const sql = `
            UPDATE medicines
            SET medName=?, batchNo=?, quantity=?, expiryDate=?, buyPrice=?, sellPrice=?
            WHERE id=?
        `;

        db.query(sql, [medName, batchNo, quantity, expiryDate, buyPrice, sellPrice, id], (err) => {
            if (err) {
                console.log(err);
                return res.json({ success: false, error: err.message });
            }
            checkSingleMedicine({ medName, batchNo, quantity, expiryDate });
            res.json({ success: true });
        });
    }
});
// ── DELETE MEDICINE ───────────────────────────────────────────
app.post("/deleteMedicine", requireLogin, (req, res) => {

    const { id } = req.body;

    db.query("DELETE FROM medicines WHERE id=?", [id], (err) => {
        if (err) {
            console.log(err);
            res.json({ success: false, error: err.message });
        } else {
            res.json({ success: true });
        }
    });
});

// ── BILLING ──────────────────────────────────────────────────
app.post("/bill", requireLogin, (req, res) => {

    const medName  = req.body.medName;
    const quantity = parseInt(req.body.quantity);
    const price    = parseFloat(req.body.price);
    const total    = quantity * price;

    const sql1 = `INSERT INTO sales (medName, quantity, unitPrice, total) VALUES (?, ?, ?, ?)`;

    db.query(sql1, [medName, quantity, price, total], (err) => {

        if (err) {
            console.log(err);
            res.send("Billing Error ❌");
            return;
        }

        const sql2 = `UPDATE medicines SET quantity = quantity - ? WHERE medName = ?`;

        db.query(sql2, [quantity, medName], (err2) => {

            if (err2) {
                console.log(err2);
                res.send("Stock Update Error ❌");
            } else {
                res.send(`
                    <html>
                    <head>
                        <title>Invoice</title>
                        <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
                    </head>
                    <body>
                    <h2>💊 MedTrack LK Invoice</h2>
                    <p>Medicine: ${medName}</p>
                    <p>Quantity: ${quantity}</p>
                    <p>Unit Price: Rs ${price}</p>
                    <p>Total: Rs ${total}</p>
                    <button onclick="window.print()">🖨 Print</button>
                    <button onclick="downloadPDF()">📥 Download PDF</button>
                    <script>
                    function downloadPDF() {
                        const doc = new window.jspdf.jsPDF();
                        doc.text("MedTrack LK Invoice", 20, 20);
                        doc.text("Medicine: ${medName}", 20, 40);
                        doc.text("Quantity: ${quantity}", 20, 50);
                        doc.text("Unit Price: Rs ${price}", 20, 60);
                        doc.text("Total: Rs ${total}", 20, 70);
                        doc.save("invoice.pdf");
                    }
                    </script>
                    </body>
                    </html>
                `);
            }

        });

    });

});

// ── SALES ────────────────────────────────────────────────────
app.get("/sales", requireLogin, (req, res) => {

    const sql = "SELECT * FROM sales ORDER BY saleDate DESC";

    db.query(sql, (err, results) => {

        if (err) {
            console.log(err);
            res.send("Database Error ❌");
        } else {
            res.json(results);
        }

    });

});

// ── STATS ────────────────────────────────────────────────────
app.get("/stats", requireLogin, (req, res) => {

    db.query("SELECT * FROM medicines", (err, medicines) => {

        if (err) {
            return res.json({
                totalMedicines: 0, totalSales: 0,
                lowStock: 0, expiring: 0,
                expired: 0, critical: 0, warning: 0, safe: 0,
                totalRevenue: 0, mostSold: "N/A"
            });
        }

        let expired = 0, critical = 0, warning = 0, safe = 0, lowStock = 0;

        const today    = new Date();
        const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

        medicines.forEach(m => {
            const expDate = new Date(m.expiryDate);
            if (isNaN(expDate)) return;

            const expUTC   = Date.UTC(expDate.getUTCFullYear(), expDate.getUTCMonth(), expDate.getUTCDate());
            const diffDays = Math.floor((expUTC - todayUTC) / (1000 * 60 * 60 * 24));

            if (diffDays < 0)        expired++;
            else if (diffDays <= 7)  critical++;
            else if (diffDays <= 30) warning++;
            else                     safe++;

            if (Number(m.quantity) <= 20) lowStock++;
        });

        db.query("SELECT COUNT(*) AS totalSales, SUM(total) AS totalRevenue FROM sales", (err2, salesResult) => {

            if (err2) console.log("Sales query error:", err2);

            const totalSales   = (!err2 && salesResult.length > 0) ? (salesResult[0].totalSales   ?? 0) : 0;
            const totalRevenue = (!err2 && salesResult.length > 0) ? Number(salesResult[0].totalRevenue ?? 0) : 0;

            db.query(
                "SELECT medName, SUM(quantity) AS totalQty FROM sales GROUP BY medName ORDER BY totalQty DESC LIMIT 1",
                (err3, topMed) => {

                    if (err3) console.log("Top med query error:", err3);

                    const mostSold = (!err3 && topMed.length > 0) ? topMed[0].medName : "N/A";

                    res.json({
                        totalMedicines: medicines.length,
                        totalSales,
                        totalRevenue,
                        mostSold,
                        expired,
                        critical,
                        warning,
                        safe,
                        lowStock,
                        expiring: critical
                    });
                }
            );
        });

    });

});

// ── MEDICINES ────────────────────────────────────────────────
app.get("/medicines", requireLogin, (req, res) => {

    db.query("SELECT * FROM medicines", (err, results) => {

        if (err) {
            console.log(err);
            res.send("Database Error ❌");
        } else {
            res.json(results);
        }

    });

});

// ── EXPIRY ALERTS ────────────────────────────────────────────
app.get("/expiry-alerts", requireLogin, (req, res) => {

    const sql = `
        SELECT * FROM medicines
        WHERE expiryDate <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log(err);
            res.send("Database Error ❌");
        } else {
            res.json(results);
        }

    });

});

// ── LOW STOCK ────────────────────────────────────────────────
app.get("/low-stock", requireLogin, (req, res) => {

    const sql = `SELECT * FROM medicines WHERE quantity <= 10`;

    db.query(sql, (err, results) => {

        if (err) {
            console.log(err);
            res.send("Database Error ❌");
        } else {
            res.json(results);
        }

    });

});

// ── SALES SUMMARY ────────────────────────────────────────────
app.get("/sales-summary", requireLogin, (req, res) => {

    const sql = `
        SELECT medName, SUM(quantity) AS totalQty
        FROM sales
        GROUP BY medName
    `;

    db.query(sql, (err, results) => {

        if (err) {
            console.log(err);
            res.send("Error ❌");
        } else {
            res.json(results);
        }

    });

});

// ── DASHBOARD ────────────────────────────────────────────────
app.get("/dashboard", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ── LOGOUT ───────────────────────────────────────────────────
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login.html");
});



// ── ALERT STATUS ─────────────────────────────────────────────
app.get("/alert-status", requireLogin, (req, res) => {
    const today   = new Date();
    const limit30 = new Date(today.getTime() + 30 * 86400000);

    db.query("SELECT * FROM medicines", (err, medicines) => {
        if (err) return res.json({ count: 0 });

        const low     = medicines.filter(m => Number(m.quantity) <= 20).length;
        const expired = medicines.filter(m => new Date(m.expiryDate) < today).length;
        const soon    = medicines.filter(m => {
            const d = new Date(m.expiryDate);
            return d >= today && d <= limit30;
        }).length;

        res.json({ count: low + expired + soon, low, expired, soon });
    });
});

// ── EMAIL STATUS ─────────────────────────────────────────────
app.get("/email-status", requireLogin, (req, res) => {
    const statusFile = path.join(__dirname, "logs", "email_status.json");
    try {
        const data = JSON.parse(fs.readFileSync(statusFile, "utf8"));
        res.json(data);
    } catch {
        res.json({ count: 0 });
    }
});

// ── START SERVER — MUST BE LAST ──────────────────────────────
const PORT = process.env.PORT || 3000;

require("./scheduler");

// ── GLOBAL ERROR HANDLER — converts thrown errors to JSON ─────
app.use((err, req, res, next) => {
    console.log("Unhandled error:", err.message);
    res.status(400).json({ success: false, error: err.message });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} ✅`);
});