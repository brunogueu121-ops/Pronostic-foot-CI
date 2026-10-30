import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import bcrypt from "bcrypt";
import cors from "cors";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "30kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

const allowedOrigin = process.env.APP_ORIGIN;
app.use(cors({
  origin: allowedOrigin || false,
  credentials: true,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(session({
  name: "pfc.sid",
  secret: process.env.SESSION_SECRET || "",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 4
  }
}));

const requireConfigured = (res) => {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    res.status(503).json({ error: "Le serveur n'est pas configuré (SESSION_SECRET)." });
    return false;
  }
  return true;
};

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Proxy vers football-data.org : la clé reste côté serveur, jamais dans l'app Android.
app.get("/api/matches", async (req, res) => {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    return res.status(503).json({ error: "Source sportive non configurée. Ajoute FOOTBALL_DATA_TOKEN côté serveur." });
  }
  try {
    const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : new Date().toISOString().slice(0, 10);
    const upstream = await fetch(`https://api.football-data.org/v4/matches?dateFrom=${date}&dateTo=${date}`, {
      headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN },
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) {
      return res.status(upstream.status === 429 ? 503 : 502).json({
        error: upstream.status === 429
          ? "Limite de requêtes du fournisseur atteinte. Réessaie plus tard."
          : "Le fournisseur sportif n'a pas pu répondre."
      });
    }
    const payload = await upstream.json();
    const matches = (payload.matches || []).map(m => ({
      id: String(m.id),
      competition: m.competition?.name || "Compétition",
      home_team: m.homeTeam?.name || "Équipe domicile",
      away_team: m.awayTeam?.name || "Équipe extérieure",
      kickoff: m.utcDate || null,
      status: ["IN_PLAY", "PAUSED", "LIVE"].includes(m.status) ? "LIVE"
        : m.status === "FINISHED" ? "FINISHED"
        : ["CANCELLED", "POSTPONED", "SUSPENDED"].includes(m.status) ? m.status : "SCHEDULED",
      home_score: m.score?.fullTime?.home ?? m.score?.regularTime?.home ?? null,
      away_score: m.score?.fullTime?.away ?? m.score?.regularTime?.away ?? null,
      venue: m.venue || null,
      source: "football-data.org"
    }));
    res.set("Cache-Control", "public, max-age=60");
    res.json({ source: "football-data.org", updated_at: new Date().toISOString(), matches });
  } catch {
    res.status(502).json({ error: "Impossible de récupérer les matchs actuellement." });
  }
});

function isAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: "Connexion administrateur requise." });
}

app.post("/api/admin/login", rateLimit({ windowMs: 15 * 60_000, limit: 8 }), async (req, res) => {
  if (!requireConfigured(res)) return;
  const { email, password } = req.body || {};
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH) {
    return res.status(503).json({ error: "Compte administrateur non provisionné côté serveur." });
  }
  if (typeof email !== "string" || typeof password !== "string" ||
      email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase() ||
      !await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH)) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  req.session.isAdmin = true;
  req.session.adminEmail = process.env.ADMIN_EMAIL;
  res.json({ ok: true });
});

app.post("/api/admin/logout", isAdmin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pfc.sid");
    res.json({ ok: true });
  });
});

// Le endpoint d'écriture reste volontairement non implémenté tant qu'une base de données
// et un journal d'audit ne sont pas configurés.
app.post("/api/admin/predictions", isAdmin, (_req, res) => {
  res.status(501).json({ error: "À activer après configuration de la base de données et du journal d'audit." });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`PronosticFoot CI API prête sur le port ${port}`));
