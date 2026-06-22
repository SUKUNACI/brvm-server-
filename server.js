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

// ✅ LISTE COMPLÈTE DES 47 SOCIÉTÉS COTÉES À LA BRVM
const TICKERS = [
  // CONSOMMATION DE BASE
  { ticker: "NTLC",  nom: "Nestlé Côte d'Ivoire",         secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "PALC",  nom: "Palm Côte d'Ivoire",            secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "SPHC",  nom: "SAPH Côte d'Ivoire",            secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "SICC",  nom: "SICOR Côte d'Ivoire",           secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "STBC",  nom: "SITAB Côte d'Ivoire",           secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "SOGC",  nom: "SOGB Côte d'Ivoire",            secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "SLBC",  nom: "Solibra Côte d'Ivoire",         secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "SCRC",  nom: "Sucrivoire Côte d'Ivoire",      secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  { ticker: "UNLC",  nom: "Unilever Côte d'Ivoire",        secteur: "Consommation de base",        pays: "CI", suffixe: "ci" },
  // CONSOMMATION DISCRÉTIONNAIRE
  { ticker: "BNBC",  nom: "Bernabé Côte d'Ivoire",         secteur: "Consommation discrétionnaire",pays: "CI", suffixe: "ci" },
  { ticker: "CFAC",  nom: "CFAO Motors Côte d'Ivoire",     secteur: "Consommation discrétionnaire",pays: "CI", suffixe: "ci" },
  { ticker: "LNBB",  nom: "Loterie Nationale du Bénin",    secteur: "Consommation discrétionnaire",pays: "BJ", suffixe: "bj" },
  { ticker: "NEIC",  nom: "NEI-CEDA Côte d'Ivoire",        secteur: "Consommation discrétionnaire",pays: "CI", suffixe: "ci" },
  { ticker: "ABJC",  nom: "Servair Abidjan",               secteur: "Consommation discrétionnaire",pays: "CI", suffixe: "ci" },
  { ticker: "PRSC",  nom: "Tractafric Motors CI",          secteur: "Consommation discrétionnaire",pays: "CI", suffixe: "ci" },
  { ticker: "UNXC",  nom: "Uniwax Côte d'Ivoire",          secteur: "Consommation discrétionnaire",pays: "CI", suffixe: "ci" },
  // ÉNERGIE
  { ticker: "SMBC",  nom: "SMB Côte d'Ivoire",             secteur: "Énergie",                     pays: "CI", suffixe: "ci" },
  { ticker: "TTLC",  nom: "TotalEnergies Côte d'Ivoire",   secteur: "Énergie",                     pays: "CI", suffixe: "ci" },
  { ticker: "TTLS",  nom: "TotalEnergies Sénégal",         secteur: "Énergie",                     pays: "SN", suffixe: "sn" },
  { ticker: "SHEC",  nom: "Vivo Energy Côte d'Ivoire",     secteur: "Énergie",                     pays: "CI", suffixe: "ci" },
  // INDUSTRIELS
  { ticker: "SDSC",  nom: "Africa Global Logistics CI",    secteur: "Industriels",                 pays: "CI", suffixe: "ci" },
  { ticker: "SEMC",  nom: "Crown Siem Côte d'Ivoire",      secteur: "Industriels",                 pays: "CI", suffixe: "ci" },
  { ticker: "SIVC",  nom: "Erium CI (ex Air Liquide)",     secteur: "Industriels",                 pays: "CI", suffixe: "ci" },
  { ticker: "FTSC",  nom: "Filtisac Côte d'Ivoire",        secteur: "Industriels",                 pays: "CI", suffixe: "ci" },
  { ticker: "STAC",  nom: "SETAO Côte d'Ivoire",           secteur: "Industriels",                 pays: "CI", suffixe: "ci" },
  { ticker: "CABC",  nom: "Sicable Côte d'Ivoire",         secteur: "Industriels",                 pays: "CI", suffixe: "ci" },
  // SERVICES FINANCIERS
  { ticker: "BOAB",  nom: "Bank of Africa Bénin",          secteur: "Services financiers",         pays: "BJ", suffixe: "bj" },
  { ticker: "BOABF", nom: "Bank of Africa Burkina Faso",   secteur: "Services financiers",         pays: "BF", suffixe: "bf" },
  { ticker: "BOAC",  nom: "Bank of Africa Côte d'Ivoire",  secteur: "Services financiers",         pays: "CI", suffixe: "ci" },
  { ticker: "BOAM",  nom: "Bank of Africa Mali",           secteur: "Services financiers",         pays: "ML", suffixe: "ml" },
  { ticker: "BOAN",  nom: "Bank of Africa Niger",          secteur: "Services financiers",         pays: "NE", suffixe: "ne" },
  { ticker: "BOAS",  nom: "Bank of Africa Sénégal",        secteur: "Services financiers",         pays: "SN", suffixe: "sn" },
  { ticker: "BICB",  nom: "BIIC Bénin",                    secteur: "Services financiers",         pays: "BJ", suffixe: "bj" },
  { ticker: "BICC",  nom: "BICI Côte d'Ivoire",            secteur: "Services financiers",         pays: "CI", suffixe: "ci" },
  { ticker: "CBIBF", nom: "Coris Bank Burkina Faso",       secteur: "Services financiers",         pays: "BF", suffixe: "bf" },
  { ticker: "ECOC",  nom: "Ecobank Côte d'Ivoire",         secteur: "Services financiers",         pays: "CI", suffixe: "ci" },
  { ticker: "ETIT",  nom: "Ecobank Transnational (Togo)",  secteur: "Services financiers",         pays: "TG", suffixe: "tg" },
  { ticker: "NSBC",  nom: "NSIA Banque Côte d'Ivoire",     secteur: "Services financiers",         pays: "CI", suffixe: "ci" },
  { ticker: "ORGT",  nom: "Oragroup Togo",                 secteur: "Services financiers",         pays: "TG", suffixe: "tg" },
  { ticker: "SAFC",  nom: "SAFCA Alios Finance CI",        secteur: "Services financiers",         pays: "CI", suffixe: "ci" },
  { ticker: "SGBC",  nom: "SGB Côte d'Ivoire",             secteur: "Services financiers",         pays: "CI", suffixe: "ci" },
  { ticker: "SIBC",  nom: "SIB Côte d'Ivoire",             secteur: "Services financiers",         pays: "CI", suffixe: "ci" },
  // SERVICES PUBLICS
  { ticker: "CIEC",  nom: "CIE Côte d'Ivoire",             secteur: "Services publics",            pays: "CI", suffixe: "ci" },
  { ticker: "SDCC",  nom: "SODECI Côte d'Ivoire",          secteur: "Services publics",            pays: "CI", suffixe: "ci" },
  // TÉLÉCOMMUNICATIONS
  { ticker: "ONTBF", nom: "ONATEL Burkina Faso",           secteur: "Télécommunications",          pays: "BF", suffixe: "bf" },
  { ticker: "ORAC",  nom: "Orange Côte d'Ivoire",          secteur: "Télécommunications",          pays: "CI", suffixe: "ci" },
  { ticker: "SNTS",  nom: "Sonatel Sénégal",               secteur: "Télécommunications",          pays: "SN", suffixe: "sn" },
];

function extraireNombre(texte) {
  if (!texte) return null;
  const propre = texte.toString()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const val = parseFloat(propre);
  return isNaN(val) ? null : val;
}

async function scraperCours(ticker, suffixe) {
  try {
    const url = `https://www.sikafinance.com/marches/cotation_${ticker}.${suffixe}`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    let coursActuel = null, variation = null, volume = null;
    let ouverture = null, haut = null, bas = null, cloture = null;

    $("table tr").each((i, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 2) {
        const label = $(cells[0]).text().trim().toLowerCase();
        const val = extraireNombre($(cells[1]).text());
        if (label.includes("clôture") || label.includes("cloture")) cloture = val;
        if (label.includes("ouverture")) ouverture = val;
        if (label.includes("plus haut") || label === "haut") haut = val;
        if (label.includes("plus bas") || label === "bas") bas = val;
        if (label.includes("volume") && label.includes("titre")) volume = val;
        if (label.includes("variation") || label.includes("var.")) variation = val;
      }
    });

    // Chercher le cours affiché en grand sur la page
    $("h1,h2,h3,h4,strong,b,.price,.cours,.last,.cotation").each((i, el) => {
      const txt = $(el).text().trim().replace(/\s/g, "");
      const val = extraireNombre(txt);
      if (val && val > 100 && val < 500000 && !coursActuel) {
        if (!ouverture || Math.abs(val - ouverture) / ouverture < 0.15) coursActuel = val;
      }
    });

    // Chercher dans tous les noeuds feuilles courts
    if (!coursActuel) {
      $("*").each((i, el) => {
        if ($(el).children().length === 0) {
          const txt = $(el).text().trim();
          if (txt.length >= 3 && txt.length <= 10) {
            const val = extraireNombre(txt);
            if (val && val > 500 && val < 500000 && !coursActuel) {
              if (!ouverture || Math.abs(val - ouverture) / ouverture < 0.10) coursActuel = val;
            }
          }
        }
      });
    }

    if (!coursActuel) coursActuel = cloture || ouverture || null;

    if (variation === null && coursActuel && cloture && cloture !== 0) {
      variation = parseFloat(((coursActuel - cloture) / cloture * 100).toFixed(2));
    }

    return {
      ticker, coursActuel, variation: variation || 0, volume: volume || 0,
      ouverture: ouverture || coursActuel, haut: haut || coursActuel,
      bas: bas || coursActuel, cloture: cloture || null,
      source: "sikafinance.com", timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return { ticker, coursActuel: null, erreur: err.message };
  }
}

async function scraperHistorique(ticker, suffixe) {
  try {
    const url = `https://www.sikafinance.com/marches/historiques/${ticker}.${suffixe}`;
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
        if (date && cours && cours > 0) historique.push({ date, cours, volume: volume || 0 });
      }
    });
    return historique.slice(0, 90);
  } catch (err) {
    return [];
  }
}

app.get("/api/cours", async (req, res) => {
  try {
    if (cache.data && cache.lastUpdate && (Date.now() - cache.lastUpdate < CACHE_DURATION)) {
      return res.json({ ...cache.data, fromCache: true });
    }
    const resultats = await Promise.all(
      TICKERS.map(async (t) => ({ ...t, ...await scraperCours(t.ticker, t.suffixe) }))
    );
    const reponse = { actions: resultats, total: resultats.length, lastUpdate: new Date().toISOString(), fromCache: false };
    cache = { data: reponse, lastUpdate: Date.now() };
    res.json(reponse);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

app.get("/api/cours/:ticker", async (req, res) => {
  try {
    const info = TICKERS.find(t => t.ticker === req.params.ticker.toUpperCase());
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

// Filtrer par secteur
app.get("/api/secteur/:secteur", async (req, res) => {
  const filtered = TICKERS.filter(t => t.secteur.toLowerCase().includes(req.params.secteur.toLowerCase()));
  res.json({ secteur: req.params.secteur, actions: filtered.map(t => t.ticker) });
});

app.get("/api/refresh", (req, res) => {
  cache = { data: null, lastUpdate: null };
  res.json({ message: "✅ Cache vidé." });
});

app.get("/", (req, res) => {
  res.json({
    status: "✅ Serveur BRVM actif",
    total_societes: TICKERS.length,
    secteurs: [...new Set(TICKERS.map(t => t.secteur))],
    endpoints: ["/api/cours", "/api/cours/:ticker", "/api/secteur/:secteur", "/api/refresh"],
    lastUpdate: cache.lastUpdate,
  });
});

app.listen(PORT, () => console.log(`✅ Serveur BRVM démarré — ${TICKERS.length} sociétés disponibles`));
