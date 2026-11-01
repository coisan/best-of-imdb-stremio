# IMDb Top Rated — Stremio Add-on

Two catalogs: IMDb Top Rated Movies and IMDb Top Rated Series (including miniseries).

Each request searches IMDb live and returns up to 30 titles, sorted by IMDb rating descending. Genre and premiere-decade filters combine with title search. Available decades start at 1910s.

- IMDb rating: at least 7.0.
- Movies: at least 50,000 votes; series: at least 25,000 votes.
- Configured Indian spoken languages are excluded before IMDb selects the results, with an additional metadata check.
- Metadata includes release year, runtime, IMDb rating, genres, languages, plot, director and cast.
- No search-result or HTTP response caching. No scheduled chart refreshes or disk snapshots.

## Run locally

Requires Node.js 20 or newer.

```powershell
npm install
npm start
```

Install http://localhost:7001/manifest.json in Stremio. Set PORT to override port 7001. Reinstall the add-on after upgrading to remove the old Popular and Trending catalogs from Stremio's saved manifest.

## Deploy

Build with the included Dockerfile and expose port 7001, or import the repository into Vercel with the Express framework preset. api/index.js exports the app and vercel.json routes requests to it.

## Endpoints

- /manifest.json: the two-catalog manifest.
- /catalog/movie/imdb-top-rated-movies.json
- /catalog/series/imdb-top-rated-series.json
- Append /genre=Crime&decade=2020s.json instead of .json to filter.
- Extras: genre, decade, search, skip. Thirty results total per selection.
- /status: live-search health and request counts.

The add-on retains its original ID for installation compatibility. Popular and Trending catalog endpoints return empty results.
