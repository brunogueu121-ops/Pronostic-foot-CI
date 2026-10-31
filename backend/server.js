import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import bcrypt from "bcrypt";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json({ limit: "30kb" }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

const allowedOrigin = process.env.APP_ORIGIN;

app.use(cors({
  origin: allowedOrigin || false,
  credentials: true
}));

app.use(session({
  name: "pronosticfoot.sid",
  secret: process.env.SESSION_SECRET || "",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

function requireConfigured(req, res, next) {
  if (!process.env.SESSION_SECRET ||
      process.env.SESSION_SECRET.length < 32) {
    return res.status(503).json({
      error: "Configuration de sécurité manquante."
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.admin) {
    return res.status(401).json({
      error: "Connexion administrateur requise."
    });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// MATCHS DE FOOTBALL
app.get("/api/matches", async (req, res) => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;

    if (!token) {
      return res.status(503).json({
        error: "Source sportive non configurée."
      });
    }

    const today = new Date();
    const defaultFrom = today.toISOString().slice(0, 10);

    const nextWeek = new Date(today);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const defaultTo = nextWeek.toISOString().slice(0, 10);

    const dateFrom = req.query.dateFrom || defaultFrom;
    const dateTo = req.query.dateTo || defaultTo;
    const competition = req.query.competition;

    const validDate = /^\d{4}-\d{2}-\d{2}$/;

    if (!validDate.test(dateFrom) || !validDate.test(dateTo)) {
      return res.status(400).json({
        error: "Format de date invalide. Utilise AAAA-MM-JJ."
      });
    }

    if (new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({
        error: "La date de début doit précéder la date de fin."
      });
    }

    if (competition &&
        !/^[A-Z0-9]{2,5}$/.test(competition)) {
      return res.status(400).json({
        error: "Code de compétition invalide."
      });
    }

    const params = new URLSearchParams({
      dateFrom,
      dateTo
    });

    if (competition) {
      params.set("competitions", competition);
    }

    const response = await fetch(
      `https://api.football-data.org/v4/matches?${params}`,
      {
        headers: {
          "X-Auth-Token": token
        },
        signal: AbortSignal.timeout(12000)
      }
    );

    if (!response.ok) {
      const detail = await response.text();

      console.error("Football-Data error:", response.status, detail);

      return res.status(502).json({
        error: "Erreur lors de la récupération des matchs.",
        provider_status: response.status
      });
    }

    const data = await response.json();

    const matches = (data.matches || []).map(match => ({
      id: match.id,
      competition: match.competition?.name || "",
      competition_code: match.competition?.code || "",
      home_team: match.homeTeam?.name || "",
      away_team: match.awayTeam?.name || "",
      utc_date: match.utcDate,
      status: match.status,
      home_score: match.score?.fullTime?.home ?? null,
      away_score: match.score?.fullTime?.away ?? null
    }));

    res.json({
      source: "football-data.org",
      updated_at: new Date().toISOString(),
      date_from: dateFrom,
      date_to: dateTo,
      competitions: competition || "ALL",
      matches
    });

  } catch (error) {
    console.error("Matches error:", error);

    res.status(500).json({
      error: "Impossible de récupérer les matchs."
    });
  }
});

// CONNEXION ADMINISTRATEUR
app.post("/api/admin/login", requireConfigured, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password ||
        !process.env.ADMIN_EMAIL ||
        !process.env.ADMIN_PASSWORD_HASH) {
      return res.status(400).json({
        error: "Identifiants ou configuration manquants."
      });
    }

    if (email !== process.env.ADMIN_EMAIL) {
      return res.status(401).json({
        error: "Identifiants incorrects."
      });
    }

    const valid = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD_HASH
    );

    if (!valid) {
      return res.status(401).json({
        error: "Identifiants incorrects."
      });
    }

    req.session.admin = true;

    res.json({
      success: true,
      message: "Connexion administrateur réussie."
    });

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      error: "Erreur de connexion."
    });
  }
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pronosticfoot.sid");
    res.json({ success: true });
  });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

// Les pronostics administrateur nécessitent encore
// une base de données et un journal de modifications.
app.post("/api/admin/predictions", requireAdmin, (req, res) => {
  res.status(501).json({
    error: "Fonction en cours de configuration."
  });
});

app.listen(PORT, () => {
  console.log(`PronosticFoot CI API démarrée sur le port ${PORT}`);
});
      
