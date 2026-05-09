const express = require("express");
const bodyParser = require("body-parser");
const path =require("path");
const app = express();
const mysql = require("mysql2");
const session = require("express-session");

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

// Temporary medicine storage
let medicines = [];
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Redirect root to login
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public","login.html"));
});

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

            // SAVE SESSION
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
            res.send("Login Failed ❌");
        }

    });

});
// Save Medicine to MySQL
app.post("/addMedicine", (req, res) => {

    const { medName, batchNo, quantity, expiryDate, buyPrice, sellPrice } = req.body;

    const sql = `
        INSERT INTO medicines
        (medName, batchNo, quantity, expiryDate, buyPrice, sellPrice)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [medName, batchNo, quantity, expiryDate, buyPrice, sellPrice],
        (err, result) => {

            if (err) {
                console.log(err);
                res.send("Database Error ❌");
            } else {
                res.send("Medicine Saved to Database ✅");
            }
        }
    );
});


app.post("/bill", (req, res) => {

    const medName = req.body.medName;
    const quantity = parseInt(req.body.quantity);
    const price = parseFloat(req.body.price);

    const total = quantity * price;

    // 1. Save bill
    const sql1 = `
        INSERT INTO sales (medName, quantity, unitPrice, total)
        VALUES (?, ?, ?, ?)
    `;

    db.query(sql1, [medName, quantity, price, total], (err) => {

        if (err) {
            console.log(err);
            res.send("Billing Error ❌");
            return;
        }

        // 2. Reduce stock
        const sql2 = `
            UPDATE medicines
            SET quantity = quantity - ?
            WHERE medName = ?
        `;

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
                    <p>Unit Price: ${price}</p>
                    <p>Total: Rs ${total}</p>
                    
                    <button onclick="window.print()">🖨 Print</button>
                    <button onclick="downloadPDF()">📥 Download PDF</button>
                    
                    <script>
                    function downloadPDF() {
                        const doc = new window.jspdf.jsPDF();
                        doc.text("MedTrack LK Invoice", 20, 20);
                        doc.text("Medicine: ${medName}", 20, 40);
                        doc.text("Quantity: ${quantity}", 20, 50);
                        doc.text("Total: Rs ${total}", 20, 60);
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

app.get("/sales", (req, res) => {

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


app.get("/stats", (req, res) => {

    const stats = {};

    const sql1 = "SELECT COUNT(*) AS totalMedicines FROM medicines";
    const sql2 = "SELECT COUNT(*) AS totalSales FROM sales";
    const sql3 = "SELECT COUNT(*) AS lowStock FROM medicines WHERE quantity <= 10";
    const sql4 = "SELECT COUNT(*) AS expiring FROM medicines WHERE expiryDate <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)";

    db.query(sql1, (err, result1) => {

        stats.totalMedicines = result1[0].totalMedicines;

        db.query(sql2, (err, result2) => {

            stats.totalSales = result2[0].totalSales;

            db.query(sql3, (err, result3) => {

                stats.lowStock = result3[0].lowStock;

                db.query(sql4, (err, result4) => {

                    stats.expiring = result4[0].expiring;

                    res.json(stats);

                });

            });

        });

    });

});

// Get Medicines from Database
app.get("/medicines", (req, res) => {

    const sql = "SELECT * FROM medicines";

    db.query(sql, (err, results) => {

        if (err) {
            console.log(err);
            res.send("Database Error ❌");
        } else {
            res.json(results);
        }

    });

});

// Expiring Medicines Alert
app.get("/expiry-alerts", (req, res) => {

    const sql = `
        SELECT *
        FROM medicines
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

// Low Stock Alerts
app.get("/low-stock", (req, res) => {

    const sql = `
        SELECT *
        FROM medicines
        WHERE quantity <= 10
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

app.get("/sales-summary", (req, res) => {

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

app.get("/dashboard", (req, res) => {

    if (!req.session.user) {
        res.send("Please login first ❌");
    } else {
        res.sendFile(__dirname + "/public/dashboard.html");
    }

});

app.get("/logout", (req, res) => {

    req.session.destroy();
    res.redirect("/login.html");

});




// Start server
app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});