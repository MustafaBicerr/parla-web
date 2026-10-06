const fs = require("node:fs");
const path = require("node:path");
const { makeLib, assemble } = require("../_lib.cjs");
const lib = makeLib(__dirname);
const parts = fs.readdirSync(path.join(__dirname, "parts")).filter((f) => f.endsWith(".cjs")).sort().map((f) => require(path.join(__dirname, "parts", f)));
fs.writeFileSync(path.join(__dirname, "index.html"), assemble(parts, lib));
console.log("index.html üretildi");
