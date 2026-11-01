const fs = require("node:fs");
// Netlify requires a publish directory, separate from server-side sources.
fs.mkdirSync("public", { recursive: true });
fs.copyFileSync("logo.png", "public/logo.png");
