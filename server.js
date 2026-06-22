const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Cache pour éviter trop de requêtes
let cache = { data: null, lastUpdate: null };
const CACHE_DURATION = 60 * 60 * 1000; // 1 heure

// Liste des tickers BRVM qu'on suit
const TICKERS = [
  { ticker: "SGBC", nom: "Société Générale CI", secteur: "Banque" },
  { ticker: "ETIT", nom: "Ecobank Transnational", secteur: "Banque" },
  { ticker: "SNTS", nom: "Sonatel", secteur: "Télécom" },
  { ticker: "BICC", nom: "BICI CI", secteur: "Banque" },
  { ticker: "PALC", nom: "Palm CI", secteur: "Agro-industrie" },
  { ticker: "SIVC", nom: "Air Liquide CI", secteur: "Industrie" },
  { ticker: "NTLC", nom: "NSIA Banque CI", secteur: "Banque" },
  { ticker: "BOAB", nom: "BOA Burkina", secteur: "Banque" },
];

// Scraper Sika Finance pour UN ticker
async function scraperCours(ticker) {
  try {
    const url = `https://www.sikafinance.com/marches/cotation_${ticker}.ci`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(data);

    // Extraire le cours actuel
    let coursActuel = null;
    let variation = null;
    let volume = null;
    let ouverture = null;
    let haut = null;
    let bas = null;

    // Chercher les données dans la page Sika Finance
    $("table tr").each((i, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 2) {
        const label = $(cells[0]).text().trim().toLowerCase();
        const valeur = $(cells[1]).text().trim().replace(/\s/g, "").replace(",", ".");

        if (label.includes("dernier") || label.includes("cours")) {
          coursActuel = parseFloat(valeur.replace(/[^\d.]/g, ""));
        }
        if (label.includes("variation") || label.includes("var")) {
          variation = parseFloat(valeur.replace(/[^\d.-]/g, ""));
        }
        if (label.includes("volume")) {
          volume = parseInt(valeur.replace(/[^\d]/g, ""));
        }
        if (label.includes("ouverture")) {
          ouverture = parseFloat(valeur.replace(/[^\d.]/g, ""));
        }
        if (label.includes("haut") || label.includes("plus haut")) {
          haut = parseFloat(valeur.replace(/[^\d.]/g, ""));
        }
        if (label.includes("bas") || label.includes("plus bas")) {
          bas = parseFloat(valeur.replace(/[^\d.]/g, ""));
        }
      }
    });

    // Si pas trouvé dans tableau, chercher dans spans/divs
    if (!coursActuel) {
      $("[class*='price'], [class*='cours'], [class*='last']").each((i, el) => {
        const txt = $(el).text().trim().replace(/[^\d.]/g, "");
        const val = parseFloat(txt);
        if (val > 100 && val < 1000000) {
          coursActuel = val;
          return false;
        }
      });
    }

    return {
      ticker,
      coursActuel: coursActuel || null,
      variation: variation || 0,
      volume: volume || 0,
      ouverture: ouverture || coursActuel,
      haut: haut || coursActuel,
      bas: bas || coursActuel,
      source: "sikafinance.com",
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`Erreur scraping ${ticker}:`, err.message);
    return { ticker, coursActuel: null, erreur: err.message };
  }
}

// Scraper l'historique d'un ticker (30 jours)
async function scraperHistorique(ticker) {
  try {
    const url = `https://www.sikafinance.com/marches/historique_${ticker}.ci`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(data);
    const historique = [];

    $("table tr").each((i, row) => {
      if (i === 0) return; // Skip header
      const cells = $(row).find("td");
      if (cells.length >= 4) {
        const date = $(cells[0]).text().trim();
        const cours = parseFloat($(cells[1]).text().trim().replace(/[^\d.]/g, ""));
        const volume = parseInt($(cells[4] || cells[3]).text().trim().replace(/[^\d]/g, "")) || 0;

        if (date && cours > 0) {
          historique.push({ date, cours, volume });
        }
      }
    });

    return historique.slice(0, 90); // 90 derniers jours max
  } catch (err) {
    console.error(`Erreur historique ${ticker}:`, err.message);
    return [];
  }
}

// Route principale : tous les cours
app.get("/api/cours", async (req, res) => {
  try {
    // Vérifier le cache
    if (cache.data && cache.lastUpdate && (Date.now() - cache.lastUpdate < CACHE_DURATION)) {
      return res.json({ ...cache.data, fromCache: true });
    }

    console.log("Scraping cours BRVM en cours...");

    // Scraper tous les tickers en parallèle
    const resultats = await Promise.all(
      TICKERS.map(async (t) => {
        const cours = await scraperCours(t.ticker);
        return { ...t, ...cours };
      })
    );

    const reponse = {
      actions: resultats,
      lastUpdate: new Date().toISOString(),
      fromCache: false,
    };

    // Mettre en cache
    cache = { data: reponse, lastUpdate: Date.now() };

    res.json(reponse);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Route : cours + historique d'une action spécifique
app.get("/api/cours/:ticker", async (req, res) => {
  try {
    const { ticker } = req.params;
    const info = TICKERS.find(t => t.ticker === ticker.toUpperCase());

    if (!info) {
      return res.status(404).json({ erreur: "Ticker non trouvé" });
    }

    const [cours, historique] = await Promise.all([
      scraperCours(ticker.toUpperCase()),
      scraperHistorique(ticker.toUpperCase()),
    ]);

    res.json({ ...info, ...cours, historique });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Route santé
app.get("/", (req, res) => {
  res.json({
    status: "✅ Serveur BRVM actif",
    endpoints: ["/api/cours", "/api/cours/:ticker"],
    lastUpdate: cache.lastUpdate,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur BRVM démarré sur le port ${PORT}`);
});
