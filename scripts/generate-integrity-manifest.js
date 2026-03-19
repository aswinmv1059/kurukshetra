const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const securityDir = path.join(projectRoot, "security");
const manifestPath = path.join(securityDir, "integrity-manifest.json");

const protectedPaths = [
  "index.html",
  "combined.js",
  "css/styles.css",
  "js/app.js",
  "js/board.js",
  "js/signals.js",
  "js/state.js",
  "js/ui.js"
];

function sha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

const files = protectedPaths.map((relativePath) => {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Protected file not found: ${relativePath}`);
  }

  return {
    path: relativePath,
    sha256: sha256(absolutePath)
  };
});

if (!fs.existsSync(securityDir)) {
  fs.mkdirSync(securityDir, { recursive: true });
}

fs.writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      files
    },
    null,
    2
  )
);

console.log(`Integrity manifest updated: ${manifestPath}`);
