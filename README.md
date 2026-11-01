# Best of IMDb

<p align="center"><img src="logo.png" alt="Best of IMDb" width="160"></p>

**Version 1.0.0** · An independent Stremio add-on for highly rated movies and series.

Best of IMDb is a standalone spin-off of [IMDb Popular](https://github.com/SSanderV/imdb-popular-stremio). It searches IMDb's database live instead of selecting from the current popularity charts. It is not affiliated with IMDb or the official IMDb Top 250 charts.

## Catalogues and selection

| Catalogue | Eligible titles | Minimum IMDb rating | Minimum votes |
| --- | --- | --- | --- |
| Best of IMDb Movies | Movies | 7.0 | 50,000 |
| Best of IMDb Series | TV series and miniseries | 7.0 | 25,000 |

Each request returns **up to 30 results**, sorted by IMDb rating, highest first. Genre, decade and title search apply before selecting those results. Decades run from 1910s to the current decade; for series, the decade refers to the premiere date. Some combinations have fewer than 30 qualifying titles.

The configured spoken-language exclusion applies to multilingual titles if **any** listed language matches. It includes Hindi, Punjabi, Tamil, Telugu, Malayalam, Bengali, Marathi, Gujarati, Kannada, Urdu and other regional languages. The complete exclusion list is `EXCLUDED_LANGUAGE_IDS` in `index.js`. Titles with missing language metadata cannot be excluded reliably.

Previews include release year, runtime, rating, genres, languages, description, cast and director when IMDb supplies them. Stremio controls the layout; additional filters may appear under its funnel button.

No search-result cache, disk snapshots, or scheduled refreshes are used. HTTP responses request no caching, including on Vercel. Each catalogue request queries IMDb; client applications may maintain their own state. Upstream requests time out after 15 seconds.

## Run locally

Requires Node.js 20 or newer and npm.

```powershell
git clone https://github.com/coisan/imdb-popular-stremio.git best-of-imdb
cd best-of-imdb
npm.cmd ci
npm.cmd start
```

Open [the local landing page](http://localhost:7001) or install `http://localhost:7001/manifest.json` in Stremio. The `PORT` environment variable overrides 7001. Use an HTTPS deployment for other devices and clients that require HTTPS; localhost on a TV refers to the TV itself.

### Migrate from the previous add-on

Uninstall the previous IMDb Popular / IMDb Top Rated installation, update the checkout and restart the server, then install the manifest again. Best of IMDb has its own ID, `community.coisan.best-of-imdb`, so it can exist independently of the original add-on. Catalogue endpoint IDs are retained for compatibility; the old Popular and Trending catalogues are not published.

```powershell
git pull origin main
npm.cmd ci
npm.cmd start
```

## Deploy

### Docker

```sh
docker build -t best-of-imdb .
docker run --name best-of-imdb -p 7001:7001 --restart unless-stopped best-of-imdb
```

The image includes the bundled logo and runs as a non-root user.

### Vercel

Import your repository and select the **Express** framework preset. `api/index.js` exports the app; `vercel.json` routes requests and disables CDN caching. No external logo host, database, scheduler or API key configuration is required by this implementation.

The current GitHub repository address remains `coisan/imdb-popular-stremio`; the package and add-on are branded Best of IMDb. If you rename the repository to `best-of-imdb` in GitHub settings, update your clone's origin URL accordingly.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/` | Installation page |
| `/manifest.json` | Best of IMDb manifest |
| `/logo.png` | Bundled logo |
| `/catalog/movie/imdb-top-rated-movies.json` | Best of IMDb Movies |
| `/catalog/series/imdb-top-rated-series.json` | Best of IMDb Series |
| `/status` | Version, live-search mode and request counters |

For filters, replace `.json` with `/genre=Crime&decade=2020s.json`. Supported extras are `genre`, `decade`, `search` and `skip`. The total result limit is 30 per selection; pagination does not extend it.

## Development and attribution

The runtime dependency is Express. Dependabot checks npm dependencies weekly. An optional pre-commit hook in `.githooks` scans staged content using Gitleaks; enable it with `git config core.hooksPath .githooks` after installing Gitleaks.

This spin-off keeps the original project's MIT license and copyright notice. See [LICENSE](LICENSE). IMDb metadata access uses the existing public GraphQL integration and remains subject to upstream availability and IMDb's terms; this is not an official IMDb API product or an exact reproduction of the Top 250 ranking.
