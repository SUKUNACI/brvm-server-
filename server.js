const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

let cache = { data: null, lastUpdate: null };
const CACHE_DURATION = 60 * 60 * 1000;

// URLs correctes pour chaque ticker sur Sika Finance
const TICKERS = [
  { ticker: "SGBC", nom: "Société Générale CI", secteur: "Banque", suffixe: "ci" },
  { ticker: "ETIT", nom: "Ecobank Transnational", secteur: "Banque", suffixe: "tg" },
  { ticker: "SNTS", nom: "Sonatel", secteur: "Télécom", suffixe: "sn" },
  { ticker: "BICC", nom: "BICI CI", secteur: "Banque", suffixe: "ci" },
  { ticker: "PALC", nom: "Palm CI", secteur: "Agro-industrie", suffixe: "ci" },
  { ticker: "SIVC", nom: "Air Liquide CI", secteur: "Industrie", suffixe: "ci" },
  { ticker: "NTLC", nom: "NSIA Banque CI", secteur: "Banque", suffixe: "ci" },
  { ticker: "BOAB", nom: "BOA Burkina", secteur: "Banque", suffixe: "bf" },
];

// Extraire un nombre depuis un texte
function extraireNombre(texte) {
  if (!texte) return null;
  const propre = texte.toString().replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const val = parseFloat(propre);
  return isNaN(val) ? null : val;
}

async function scraperCours(ticker, suffixe) {
  try {
    const url = `https://www.sikafinance.com/marches/cotation_${ticker}.${suffixe}`;
    console.log(`Scraping: ${url}`);

    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);

    let coursActuel = null;
    let variation = null;
    let volume = null;
    let ouverture = null;
    let haut = null;
    let bas = null;

    // Méthode 1 : chercher dans tous les éléments avec du texte numérique
    // Sika Finance utilise souvent des classes spécifiques
    const selecteurs = [
      ".last-price", ".cours-actuel", ".price-last", ".cotation-price",
      "[class*='last']", "[class*='price']", "[class*='cours']", "[class*='cotation']"
    ];

    for (const sel of selecteurs) {
      $(sel).each((i, el) => {
        const txt = $(el).text().trim();
        const val = extraireNombre(txt);
        if (val && val > 100 && val < 2000000 && !coursActuel) {
          coursActuel = val;
        }
      });
      if (coursActuel) break;
    }

    // Méthode 2 : parcourir tous les tableaux
    $("table tr").each((i, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 2) {
        const label = $(cells[0]).text().trim().toLowerCase();
        const valTxt = $(cells[1]).text().trim();
        const val = extraireNombre(valTxt);

        if ((label.includes("dernier") || label.includes("clôture") || label.includes("cloture")) && val) {
          coursActuel = val;
        }
        if (label.includes("variation") && val !== null) variation = val;
        if (label.includes("volume") && val) volume = val;
        if (label.includes("ouverture") && val) ouverture = val;
        if ((label.includes("plus haut") || label === "haut") && val) haut = val;
        if ((label.includes("plus bas") || label === "bas") && val) bas = val;
      }
    });

    // Méthode 3 : chercher dans les div/span avec data-attributes
    if (!coursActuel) {
      $("[data-price], [data-cours], [data-last]").each((i, el) => {
        const val = extraireNombre($(el).attr("data-price") || $(el).attr("data-cours") || $(el).attr("data-last"));
        if (val && val > 100) coursActuel = val;
      });
    }

    // Méthode 4 : chercher le plus grand nombre isolé sur la page
    // qui ressemble à un cours boursier (entre 100 et 500000 FCFA)
    if (!coursActuel) {
      $("span, div, p, td, strong, b").each((i, el) => {
        const txt = $(el).text().trim();
        // Texte court qui ressemble à un prix
        if (txt.length < 15 && txt.length > 2) {
          const val = extraireNombre(txt);
          if (val && val > 500 && val < 500000 && !coursActuel) {
            // Vérifier que c'est cohérent avec ouverture si disponible
            if (!ouverture || Math.abs(val - ouverture) / ouverture < 0.1) {
              coursActuel = val;
            }
          }
        }
      });
    }

    // Fallback : utiliser ouverture comme cours si toujours null
    if (!coursActuel && ouverture) {
      coursActuel = ouverture;
      console.log(`${ticker}: coursActuel = ouverture (fallback) = ${ouverture}`);
    }

    console.log(`${ticker}: cours=${coursActuel}, variation=${variation}, ouverture=${ouverture}`);

    return {
      ticker,
      coursActuel,
      variation: variation || 0,
      volume: volume || 0,
      ouverture: ouverture || coursActuel,
      haut: haut || coursActuel,
      bas: bas || coursActuel,
      source: "sikafinance.com",
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`Erreur ${ticker}:`, err.message);
    return { ticker, coursActuel: null, erreur: err.message };
  }
}

async function scraperHistorique(ticker, suffixe) {
  try {
    const url = `https://www.sikafinance.com/marches/historique_${ticker}.${suffixe}`;
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const historique = [];

    $("table tr").each((i, row) => {
      if (i === 0) return;
      const cells = $(row).find("td");
      if (cells.length >= 2) {
        const date = $(cells[0]).text().trim();
        const cours = extraireNombre($(cells[1]).text());
        const volume = extraireNombre($(cells[cells.length - 1]).text());

        if (date && cours && cours > 0) {
          historique.push({ date, cours, volume: volume || 0 });
        }
      }
    });

    return historique.slice(0, 90);
  } catch (err) {
    console.error(`Erreur historique ${ticker}:`, err.message);
    return [];
  }
}

// Route : tous les cours
app.get("/api/cours", async (req, res) => {
  try {
    if (cache.data && cache.lastUpdate && (Date.now() - cache.lastUpdate < CACHE_DURATION)) {
      return res.json({ ...cache.data, fromCache: true });
    }

    console.log("Scraping tous les cours BRVM...");

    const resultats = await Promise.all(
      TICKERS.map(async (t) => {
        const cours = await scraperCours(t.ticker, t.suffixe);
        return { ...t, ...cours };
      })
    );

    const reponse = {
      actions: resultats,
      lastUpdate: new Date().toISOString(),
      fromCache: false,
    };

    cache = { data: reponse, lastUpdate: Date.now() };
    res.json(reponse);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Route : cours + historique d'une action
app.get("/api/cours/:ticker", async (req, res) => {
  try {
    const { ticker } = req.params;
    const info = TICKERS.find(t => t.ticker === ticker.toUpperCase());

    if (!info) return res.status(404).json({ erreur: "Ticker non trouvé" });

    const [cours, historique] = await Promise.all([
      scraperCours(info.ticker, info.suffixe),
      scraperHistorique(info.ticker, info.suffixe),
    ]);

    res.json({ ...info, ...cours, historique });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Vider le cache manuellement
app.get("/api/refresh", (req, res) => {
  cache = { data: null, lastUpdate: null };
  res.json({ message: "Cache vidé. Prochain appel /api/cours rechargera les données." });
});

app.get("/", (req, res) => {
  res.json({
    status: "✅ Serveur BRVM actif",
    endpoints: ["/api/cours", "/api/cours/:ticker", "/api/refresh"],
    lastUpdate: cache.lastUpdate,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur BRVM démarré sur le port ${PORT}`);
});
