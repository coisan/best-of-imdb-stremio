const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
process.env.LAMBDA_TASK_ROOT = path.resolve(__dirname, "..");
const { handler } = require("../netlify/functions/api");

function request(pathname) {
  return handler({ httpMethod: "GET", path: pathname, rawUrl: "https://best-of-imdb.example" + pathname,
    headers: { host: "best-of-imdb.example", "x-forwarded-proto": "https" }, queryStringParameters: {}, body: null, isBase64Encoded: false }, {});
}

test("Netlify adapter serves manifest, installation page, status and binary logo", async () => {
  const response = await request("/manifest.json");
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["cache-control"], /no-store/);
  assert.equal(response.headers["access-control-allow-origin"], "*");
  const manifest = JSON.parse(response.body);
  assert.equal(manifest.name, "Best of IMDb");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.catalogs.length, 2);
  assert.equal(manifest.logo, "https://best-of-imdb.example/logo.png");
  assert.match((await request("/")).body, /Best of IMDb/);
  assert.equal(JSON.parse((await request("/status")).body).mode, "live-search");
  const logo = await request("/logo.png");
  assert.equal(logo.statusCode, 200);
  assert.equal(logo.isBase64Encoded, true);
  assert.equal(Buffer.from(logo.body, "base64").subarray(1, 4).toString(), "PNG");
});

test("Netlify adapter preserves catalog filters and returns fresh movie and series searches", async () => {
  const originalFetch = global.fetch;
  const searches = [];
  global.fetch = async (_url, options) => {
    searches.push(JSON.parse(options.body).variables.constraints);
    return { ok: true, json: async () => ({ data: { advancedTitleSearch: { edges: [{ node: { title: {
      id: "tt123", titleText: { text: "Fixture" }, releaseYear: { year: 2021 },
      ratingsSummary: { aggregateRating: 8, voteCount: 100000 },
      spokenLanguages: { spokenLanguages: [{ id: "en", text: "English" }] }
    } } }] } } }) };
  };
  try {
    for (const type of ["movie", "series"]) {
      const id = type === "movie" ? "imdb-top-rated-movies" : "imdb-top-rated-series";
      const response = await request("/catalog/" + type + "/" + id + "/genre=Crime&decade=2020s.json");
      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.metas[0].type, type);
      assert.equal(data.metas[0].releaseInfo, "2021");
      const constraints = searches.at(-1);
      assert.deepEqual(constraints.genreConstraint.allGenreIds, ["Crime"]);
      assert.equal(constraints.releaseDateConstraint.releaseDateRange.start, "2020-01-01");
      assert.equal(constraints.userRatingsConstraint.ratingsCountRange.min, type === "movie" ? 50000 : 25000);
      assert.ok(constraints.languageConstraint.excludeLanguages.includes("hi"));
    }
    await request("/catalog/movie/imdb-top-rated-movies/genre=Crime&decade=2020s.json");
    assert.equal(searches.length, 3);
  } finally { global.fetch = originalFetch; }
});
