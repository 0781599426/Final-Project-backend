const https = require("https");
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const axios = require("axios");
const bcrypt = require("bcrypt");
const flash = require("connect-flash");
const i18n = require("i18n");
const cookieParser = require("cookie-parser");

dotenv.config();

const app = express();

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
axios.defaults.httpsAgent = httpsAgent;

// Middleware Setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(flash());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

// Session Setup
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your_secret_key",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(cookieParser());

// i18n Configuration
i18n.configure({
  locales: ["en", "fa", "ru"],
  directory: path.join(__dirname, "../locales"),
  defaultLocale: "en",
  cookie: "lang",
  queryParameter: "lang",
  autoReload: true,
  syncFiles: true,
});
app.use(i18n.init);

// Language Middleware
app.use((req, res, next) => {
  let lang = req.query.lang || req.cookies.lang || "en";
  res.cookie("lang", lang, { maxAge: 900000, httpOnly: true });
  res.setLocale(lang);
  next();
});

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.successMessage = req.flash("success");
  res.locals.errorMessage = req.flash("error");
  next();
});

// MongoDB connection
if (!mongoose.connections[0].readyState) {
  mongoose
    .connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch((error) => console.error("MongoDB connection error:", error));
}

// Schemas and Models
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const itemSchema = new mongoose.Schema({
  pictures: [{ type: String, required: true }],
  name_en: { type: String, required: true },
  name_local: { type: String, required: true },
  description_en: { type: String, required: true },
  description_local: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date,
  deletedAt: Date,
});

const api1Schema = new mongoose.Schema({
  title: String,
  description: String,
  url: String,
  publishedAt: Date,
  source: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

const historySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  action: { type: String, required: true },
  input: { type: String },
  date: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Item = mongoose.model("Item", itemSchema);
const API1 = mongoose.model("API1", api1Schema);
const History = mongoose.model("History", historySchema);

// Middleware to check session
function isAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

// Language Selection
app.get("/change-language", (req, res) => {
  res.cookie("lang", req.query.lang, { maxAge: 900000, httpOnly: true });
  const redirectUrl = req.get("Referrer") || "/";
  res.redirect(redirectUrl);
});

// Routes - Auth
app.get("/", (req, res) => res.render("login"));

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log(`Login attempt for username: ${username}`);
  const user = await User.findOne({ username });
  if (user && (await bcrypt.compare(password, user.password))) {
    req.session.user = user;
    return res.redirect("/main");
  }
  req.flash("error", "Wrong username or password, please try again.");
  res.redirect("/");
});

app.get("/signup", (req, res) => {
  res.render("signup");
});

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      req.flash("error", "Username already exists. Please choose another.");
      return res.redirect("/signup");
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      password: hashedPassword,
    });
    await newUser.save();
    req.flash("success", "Account created successfully. Please log in.");
    res.redirect("/");
  } catch (error) {
    console.error("Error during sign-up:", error);
    req.flash("error", "An error occurred. Please try again.");
    res.redirect("/signup");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// Main pages
app.get("/main", isAuthenticated, (req, res) => {
  res.render("main", {
    username: req.session.user.username,
    isAdmin: req.session.user.isAdmin,
  });
});

// Utility function for valid URLs
function isValidURL(url) {
  try {
    new URL(url);
    return true;
  } catch (_) {
    return false;
  }
}

// API Endpoints
app.get("/items", async (req, res) => {
  try {
    const items = await Item.find({ deletedAt: null });
    res.json(items);
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/items/:id", async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item || item.deletedAt) {
      return res.status(404).send("Item not found");
    }
    res.json(item);
  } catch (error) {
    console.error("Error fetching item:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

// Export app for Vercel
module.exports = app;
