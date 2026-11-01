const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 7001;
const VERSION = require("./package.json").version;

// ---------------------------------------------------------------------------
// IMDb GraphQL source
// ---------------------------------------------------------------------------

const IMDB_GQL = "https://api.graphql.imdb.com/";

// The WAF checks that x-imdb-client-name is present; without it every request
// is a bare 403. The locale pair pins titles and certificates to en-US —
// IMDb localises otherwise, e.g. country=EE returns "Ämblikmees. Täitsa uus päev".
const IMDB_HEADERS = {
  "content-type": "application/json",
  "x-imdb-client-name": "imdb-web-next",
  "x-imdb-user-country": "US",
  "x-imdb-user-language": "en-US",
};


const TITLE_FIELDS = `
  id
  titleText { text }
  titleType { id }
  releaseYear { year }
  spokenLanguages { spokenLanguages { id text } }
  primaryImage { url }
  ratingsSummary { aggregateRating voteCount }
  runtime { seconds }
  certificate { rating }
  titleGenres { genres { genre { text } } }
  plot { plotText { plainText } }
  principalCreditsV2 { grouping { text } credits { name { nameText { text } } } }
`;

// ---------------------------------------------------------------------------
// Transformation
// ---------------------------------------------------------------------------

// IMDb labels credit groups in both singular and plural — Director/Directors,
// Creator/Creators, Star/Stars — so an exact match silently drops multi-credit
// titles.
const DIRECTOR_GROUP = /^(director|creator)s?$/i;
const CAST_GROUP = /^stars?$/i;

function creditNames(groups, pattern) {
  const group = (groups || []).find((g) => pattern.test(g.grouping?.text || ""));
  if (!group) return null;
  const names = (group.credits || [])
    .map((c) => c.name?.nameText?.text)
    .filter(Boolean);
  return names.length ? names : null;
}

// Spoken-language exclusions, including India's scheduled languages and common regional languages.
const EXCLUDED_LANGUAGE_IDS = new Set([
  "as", "bn", "brx", "doi", "gu", "hi", "kn", "ks", "kok", "mai", "ml", "mni",
  "mr", "ne", "or", "pa", "sa", "sat", "sd", "ta", "te", "ur", "bho", "awa",
  "hne", "mag", "raj", "mwr", "tcy", "kfy", "gbm", "kha", "lus", "grt", "lep", "bh",
]);
function hasExcludedLanguage(meta) {
  return (meta.languages || []).some((language) => EXCLUDED_LANGUAGE_IDS.has(language.id));
}

function nodeToMeta(node, type) {
  if (!node || !node.id) return null;
  const meta = { id: node.id, type, name: node.titleText?.text || "Unknown" };

  if (node.primaryImage?.url) meta.poster = node.primaryImage.url;
  if (node.plot?.plotText?.plainText) meta.description = node.plot.plotText.plainText;
  if (node.releaseYear?.year) {
    meta.year = String(node.releaseYear.year);
    meta.releaseInfo = meta.year;
  }
  if (node.certificate?.rating) meta.certification = node.certificate.rating;

  const rating = node.ratingsSummary?.aggregateRating;
  if (rating != null) meta.imdbRating = String(rating);

  const genres = (node.titleGenres?.genres || [])
    .map((g) => g.genre?.text)
    .filter(Boolean);
  if (genres.length) meta.genres = genres;
  const languages = (node.spokenLanguages?.spokenLanguages || []).filter((l) => l.id && l.text);
  meta.languages = languages;
  if (hasExcludedLanguage(meta)) return null;

  const seconds = node.runtime?.seconds;
  if (seconds) {
    const mins = Math.round(seconds / 60);
    meta.runtime = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}min` : `${mins} min`;
  }

  const director = creditNames(node.principalCreditsV2, DIRECTOR_GROUP);
  if (director) meta.director = director;
  const cast = creditNames(node.principalCreditsV2, CAST_GROUP);
  if (cast) meta.cast = cast;

  // Internal — stripped before serving to Stremio
  meta._votes = node.ratingsSummary?.voteCount || 0;
  return meta;
}

async function gql(query, variables) {
  const res = await fetch(IMDB_GQL, {
    method: "POST",
    headers: IMDB_HEADERS,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

function parseExtra(str) {
  const result = {};
  if (!str) return result;
  for (const pair of str.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    result[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
  }
  return result;
}

function stripInternal({ _votes, ...clean }) {
  // Ensure every preview includes Stremio’s display-year field.
  if (!clean.releaseInfo && clean.year) clean.releaseInfo = String(clean.year);
  if (clean.languages?.length) {
    // Explicit links preserve existing metadata groups and put languages after genres.
    clean.links = [
      ...(clean.imdbRating ? [{ category: "imdb", name: clean.imdbRating, url: "https://imdb.com/title/" + clean.id }] : []),
      ...(clean.genres || []).map((name) => ({ category: "Genres", name, url: "stremio:///search?search=" + encodeURIComponent(name) })),
      ...clean.languages.map((language) => ({ category: "Languages", name: language.text, url: "https://www.imdb.com/search/title/?primary_language=" + encodeURIComponent(language.id) })),
      ...(clean.director || []).map((name) => ({ category: "Director", name, url: "stremio:///search?search=" + encodeURIComponent(name) })),
      ...(clean.cast || []).map((name) => ({ category: "Cast", name, url: "stremio:///search?search=" + encodeURIComponent(name) })),
    ];
    delete clean.languages;
  }
  return clean;
}

const SEARCH_LIMIT = 30;
const TOP_RATED_GENRES = ["Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Musical", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western"];
const TOP_RATED_DECADES = Array.from({ length: Math.floor((new Date().getFullYear() - 1910) / 10) + 1 }, (_, i) => String(Math.floor(new Date().getFullYear() / 10) * 10 - i * 10) + "s");

async function searchTopTitles(type, extra) {
  const skip = Number.parseInt(extra.skip, 10) || 0;
  if (skip >= SEARCH_LIMIT) return [];
  if (extra.genre && !TOP_RATED_GENRES.includes(extra.genre)) return [];
  if (extra.decade && !TOP_RATED_DECADES.includes(extra.decade)) return [];
  const constraints = {
    titleTypeConstraint: { anyTitleTypeIds: type === "series" ? ["tvSeries", "tvMiniSeries"] : ["movie"] },
    languageConstraint: { excludeLanguages: [...EXCLUDED_LANGUAGE_IDS] },
    userRatingsConstraint: { ratingsCountRange: { min: type === "movie" ? 50000 : 25000 }, aggregateRatingRange: { min: 7.0 } },
  };
  if (extra.genre) constraints.genreConstraint = { allGenreIds: [extra.genre] };
  if (extra.decade) {
    const year = Number(extra.decade.slice(0, 4));
    constraints.releaseDateConstraint = { releaseDateRange: { start: year + "-01-01", end: (year + 9) + "-12-31" } };
  }
  if (extra.search) constraints.titleTextConstraint = { searchTerm: extra.search };
  const query = `query TopTitles($constraints: AdvancedTitleSearchConstraints!) {
    advancedTitleSearch(first: 30, constraints: $constraints, sort: { sortBy: USER_RATING, sortOrder: DESC }) {
      edges { node { title { ${TITLE_FIELDS} } } }
    }
  }`;
  const data = await gql(query, { constraints });
  if (!data.advancedTitleSearch?.edges) throw new Error("IMDb returned no search data");
  return data.advancedTitleSearch.edges
    .map((e) => nodeToMeta(e.node?.title, type))
    .filter(Boolean).map(stripInternal).slice(Math.max(0, skip));
}

async function resolveCatalog(type, id, extra) {
  if (type === "movie" && id === "imdb-top-rated-movies") return searchTopTitles(type, extra);
  if (type === "series" && id === "imdb-top-rated-series") return searchTopTitles(type, extra);
  return [];
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function buildManifest(proto, host) {
  const topRatedExtras = [{ name: "genre", options: TOP_RATED_GENRES }, { name: "decade", options: TOP_RATED_DECADES }, { name: "search" }, { name: "skip" }];

  return {
    id: "community.coisan.best-of-imdb",
    version: VERSION,
    name: "Best of IMDb",
    description:
      "The best-rated movies and series on IMDb. Filter by genre and decade.",
    logo: `${proto}://${host}/logo.png`,
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
      { type: "movie", id: "imdb-top-rated-movies", name: "Best of IMDb Movies", extra: topRatedExtras },
      { type: "series", id: "imdb-top-rated-series", name: "Best of IMDb Series", extra: topRatedExtras },
    ],
    behaviorHints: { configurable: false },
    idPrefixes: ["tt"],
  };
}

function originOf(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return { proto, host: req.headers.host };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const hits = { manifest: 0, catalog: 0 };

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

// Logo ---
const LOGO_PATH = path.join(process.env.LAMBDA_TASK_ROOT || __dirname, "logo.png");

// Landing page
app.get("/", (req, res) => {
  const { proto, host } = originOf(req);
  const manifest = buildManifest(proto, host);
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest.name} - Stremio Addon</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #10131c;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 520px;
    }
    .logo {
      width: 120px;
      height: 120px;
      margin-bottom: 1.5rem;
      border-radius: 20px;
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.75rem;
    }
    .description {
      font-size: 1.05rem;
      color: #a0a0c0;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .install-btn {
      display: inline-block;
      background: #e8bc4b;
      color: #10131c;
      text-decoration: none;
      padding: 0.9rem 2.5rem;
      border-radius: 8px;
      font-size: 1.1rem;
      font-weight: 600;
      transition: background 0.2s, transform 0.1s;
    }
    .install-btn:hover {
      background: #d7a72c;
      transform: translateY(-1px);
    }
    .install-btn:active {
      transform: translateY(0);
    }
    .catalogs {
      margin-top: 2.5rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
    }
    .catalog-tag {
      background: rgba(123, 91, 245, 0.15);
      color: #b0a0e0;
      padding: 0.35rem 0.75rem;
      border-radius: 20px;
      font-size: 0.8rem;
    }
    footer {
      position: fixed;
      bottom: 1rem;
      color: #505070;
      font-size: 0.8rem;
    }
    footer a { color: #7b5bf5; text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <img src="/logo.png" alt="${manifest.name}" class="logo">
    <h1>${manifest.name}</h1>
    <p class="description">${manifest.description}</p>
    <a href="stremio://${host}/manifest.json" class="install-btn">Install to Stremio</a>
    <div class="catalogs">
      ${manifest.catalogs.map((c) => `<span class="catalog-tag">${c.name}</span>`).join("\n      ")}
    </div>
  </div>
  <footer>v${manifest.version} &middot; <a href="/manifest.json">Manifest</a></footer>
</body>
</html>`);
});

app.get("/logo.png", (_, res) => {
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store");
  res.sendFile(LOGO_PATH);
});

// Always request current manifests and catalog results from the server.
function catalogCacheControl(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
}

// Routes ---
app.get("/manifest.json", (req, res) => {
  hits.manifest++;
  catalogCacheControl(req, res);
  const { proto, host } = originOf(req);
  res.json(buildManifest(proto, host));
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  hits.catalog++;
  catalogCacheControl(req, res);
  res.json({ metas: await resolveCatalog(req.params.type, req.params.id, {}) });
});

app.get("/catalog/:type/:id/:extra.json", async (req, res) => {
  hits.catalog++;
  catalogCacheControl(req, res);
  res.json({
    metas: await resolveCatalog(req.params.type, req.params.id, parseExtra(req.params.extra)),
  });
});

// Live-search health and request counters.
app.get("/status", (_, res) => {
  res.set("Cache-Control", "no-cache");
  res.json({ status: "ok", version: VERSION, source: "imdb-graphql", mode: "live-search", hits, catalogs: ["imdb-top-rated-movies", "imdb-top-rated-series"] });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

module.exports = app;

if (require.main === module) {
    app.listen(PORT, "0.0.0.0", () =>
      console.log(`Best of IMDb addon v${VERSION} on :${PORT}`)
    );
}
