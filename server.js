const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");
const cors = require("cors");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 2024;

// Middlewares
app.use(bodyParser.json({ limit: "10mb" }));
app.use(cors());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DB_CONNECT_STRING,
  port: 4040,
});
pool.connect((err) => {
  if (err) {
    return console.error("Couldn't connect to postgres", err);
  }
  console.log("Succesfully connected to postgres database");
});
// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASS,
  },
});

// Route to create necessary tables
app.get("/init", async (req, res) => {
  console.log("received");
  const createUserTable = `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

  const createFilesTable = `CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        category VARCHAR(255) NOT NULL,
        division VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        cover_image_path VARCHAR(255),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

  try {
    await pool.query(createUserTable);
    await pool.query(createFilesTable);
    res.send("Tables created successfully");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register route
app.post("/register", async (req, res) => {
  console.log("Regitser request received");
  const { email } = req.body;
  const password = crypto.randomBytes(8).toString("hex"); // Generate random password

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const query =
      "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id";
    const result = await pool.query(query, [email, hashedPassword]);

    // Send email with password

    transporter
      .sendMail({
        to: email, // list of receivers
        subject: "This is your password", // Subject line
        text: "Your password is below", // plain text body
        html: `<html><b>${password}</b></html>`, // html body
      })
      .then(() => console.log("Email Sent"))
      .catch((e) => console.log(e));

    res.status(200).json({
      message:
        "User registered successfully. Password has been sent to your email.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login route
app.post("/login", async (req, res) => {
  console.log("Login request recieved");
  const { email, password } = req.body;

  try {
    const query = "SELECT * FROM users WHERE email = $1";
    const result = await pool.query(query, [email]);
    console.log(result.rows);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect password" });
    }
    console.log("Succesfully Logged In");

    res.status(200).json({ message: "Login successful", user: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
    console.log(err);
  }
});

// Route to handle file and cover image upload
app.post(
  "/upload",
  upload.fields([
    { name: "pdf", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
  ]),
  async (req, res) => {
    console.log("Upload Request Received");
    const { title, userId, category, division } = req.body;
    const pdfFile = req.files["pdf"];
    // console.log(req.file);
    const coverImage = req.files["coverImage"];
    console.log(title, userId, category, pdfFile[0], coverImage[0]);
    const coverImageFile = req.files["coverImage"]
      ? req.files["coverImage"]
      : null;
    const pdfFilePath = path.join("uploads", pdfFile[0].filename);
    const coverImagePath = coverImageFile[0]
      ? path.join("uploads", coverImageFile[0].filename)
      : null;
    console.log(coverImageFile[0]);

    try {
      const query =
        "INSERT INTO files (user_id, title, category, division, file_path, cover_image_path) VALUES ($1, $2, $3, $4, $5, $6)";

      await pool.query(query, [
        userId,
        title,
        category,
        division,
        pdfFilePath,
        coverImagePath,
      ]);
      res.status(200).json({
        message: "File and cover image uploaded successfully",
        pdfFilePath,
        coverImagePath,
      });
      console.log("It worked");
    } catch (err) {
      res.status(500).json({ error: err.message });
      console.log("didn't work: ", err.message);
    }
  }
);
app.get("/files", async (req, res) => {
  try {
    const query = "SELECT * FROM files";
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Search route
app.get("/search", async (req, res) => {
  const query = req.query.query.toLowerCase();
  try {
    const searchQuery = `
      SELECT * FROM files
      WHERE LOWER(title) ILIKE $1 OR LOWER(category) ILIKE $1
    `;
    const result = await pool.query(searchQuery, [`%${query}%`]);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/files/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const query = "DELETE FROM files WHERE id = $1 RETURNING *";
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }
    console.log(result.rows);
    // Delete the file from the file system
    const filePath = result.rows[0].file_path;
    const coverImagePath = result.rows[0].cover_image_path;
    fs.unlinkSync(filePath);
    if (coverImagePath) {
      fs.unlinkSync(coverImagePath);
    }
    console.log("Deleted successfully");

    res.status(200).json({ message: "File deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
    console.log("Deleted Unsuccesfully: ", err);
  }
});

// Route to update a file by ID
app.put("/files/:id", async (req, res) => {
  const { id } = req.params;
  const { title, category } = req.body;
  console.log();
  try {
    const query =
      "UPDATE files SET title = $1, category = $2 WHERE id = $3 RETURNING *";
    const result = await pool.query(query, [title, category, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }
    console.log("Updated Successfully");
    res
      .status(200)
      .json({ message: "File updated successfully", file: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
    console.log("Updated Unsuccesfully: ", err);
  }
});

app.get("/download/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, "uploads", filename);
  res.download(filePath, (err) => {
    if (err) {
      console.error("File download error:", err);
      res.status(500).send("File not found");
    }
  });
});

// Create uploads folder if it doesn't exist
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
