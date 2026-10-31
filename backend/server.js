app.get("/api/matches", async (req, res) => {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    return res.status(503).json({
      error: "Source sportive non configurée."
    });
  }

  try {
    const validDate = (value) =>
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value));

    const today = new Date().toISOString().slice(0, 10);
    const defaultEnd = new Date(Date.now() + 7 * 86400000)
      .toISOString().slice(0, 10);

    const dateFrom = validDate(req.query.dateFrom)
      ? req.query.dateFrom : today;

    const dateTo = validDate(req.query.dateTo)
      ? req.query.dateTo : defaultEnd;

    if (dateTo < dateFrom) {
      return res.status(400).json({
        error: "La date de fin doit être après la date de début."
      });
    }

    const params = new URLSearchParams({
      dateFrom,
      dateTo
    });

    // Filtre facultatif par code de compétition
    if (typeof req.query.competition === "string") {
      const competition = req.query.competition.trim().toUpperCase();

      if (!/^[A-Z0-9]{2,5}$/.test(competition)) {
        return res.status(400).json({
          error: "Code de compétition invalide."
        });
      }

      params.set("competitions", competition);
    }

    const upstream = await fetch(
      `https://api.football-data.org/v4/matches?${params}`,
      {
        headers: {
          "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN
        },
        signal: AbortSignal.timeout(12000)
      }
    );

    if (!upstream.ok) {
      return res.status(upstream.status === 429 ? 503 : 502).json({
        error: upstream.status === 429
          ? "Limite de requêtes atteinte. Réessaie plus tard."
          : "Le fournisseur sportif n'a pas pu répondre.",
        provider_status: upstream.status
      });
    }

    const payload = await upstream.json();

    const matches = (payload.matches || []).map(m => ({
      id: String(m.id),
      competition: m.competition?.name || "Compétition",
      competition_code: m.competition?.code || null,
      home_team: m.homeTeam?.name || "Équipe domicile",
      away_team: m.awayTeam?.name || "Équipe extérieure",
      kickoff: m.utcDate || null,
      status: ["IN_PLAY", "PAUSED", "LIVE"].includes(m.status)
        ? "LIVE"
        : m.status === "FINISHED"
          ? "FINISHED"
          : ["CANCELLED", "POSTPONED", "SUSPENDED"].includes(m.status)
            ? m.status : "SCHEDULED",
      home_score: m.score?.fullTime?.home ??
        m.score?.regularTime?.home ?? null,
      away_score: m.score?.fullTime?.away ??
        m.score?.regularTime?.away ?? null,
      venue: m.venue || null,
      source: "football-data.org"
    }));

    const competitions = [
      ...new Map(
        (payload.matches || [])
          .filter(m => m.competition?.code)
          .map(m => [
            m.competition.code,
            {
              code: m.competition.code,
              name: m.competition.name
            }
          ])
      ).values()
    ];

    res.set("Cache-Control", "public, max-age=60");
    res.json({
      source: "football-data.org",
      updated_at: new Date().toISOString(),
      date_from: dateFrom,
      date_to: dateTo,
      competitions,
      matches
    });

  } catch (error) {
    console.error("Erreur récupération matchs:", error.message);
    res.status(502).json({
      error: "Impossible de récupérer les matchs actuellement."
    });
  }
});
    
