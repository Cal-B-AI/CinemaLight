// Assembles the single-file app (app/index.html) from src/head.html + src/app.js.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const head = fs.readFileSync(path.join(root, "src/head.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
const pre = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style>';
fs.mkdirSync(path.join(root, "app"), { recursive: true });
fs.writeFileSync(path.join(root, "app/index.html"), pre + head + "<script>\n" + js + "</script>\n</html>\n");
console.log("Built app/index.html");
