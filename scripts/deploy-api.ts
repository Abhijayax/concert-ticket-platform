import { execSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const coreDir = resolve(rootDir, "packages/core");
const apiDir = resolve(rootDir, "apps/api");
const deployDir = resolve(rootDir, ".deploy/api");

const appName = process.env.AZURE_FUNCTIONAPP_NAME || "concertticket-api-0u1e9n";

console.log("1. Building monorepo packages...");
execSync("npm run build", { cwd: rootDir, stdio: "inherit" });

console.log("2. Packing @tix/core...");
const packOutput = execSync("npm pack --json", { cwd: coreDir, encoding: "utf8" });
const [packInfo] = JSON.parse(packOutput) as [{ filename: string }];
const coreTarball = packInfo.filename;
const coreTarballPath = resolve(coreDir, coreTarball);

console.log("3. Staging deployment bundle at .deploy/api...");
rmSync(deployDir, { recursive: true, force: true });
mkdirSync(deployDir, { recursive: true });

// Copy host.json and dist
copyFileSync(resolve(apiDir, "host.json"), resolve(deployDir, "host.json"));
cpSync(resolve(apiDir, "dist"), resolve(deployDir, "dist"), { recursive: true });

// Copy core tarball into staging dir
copyFileSync(coreTarballPath, resolve(deployDir, coreTarball));
rmSync(coreTarballPath, { force: true });

// Read apps/api/package.json and rewrite @tix/core to local tarball
const apiPkg = JSON.parse(readFileSync(resolve(apiDir, "package.json"), "utf8")) as Record<
  string,
  unknown
>;
const dependencies = (apiPkg.dependencies ?? {}) as Record<string, string>;
dependencies["@tix/core"] = `file:./${coreTarball}`;

writeFileSync(
  resolve(deployDir, "package.json"),
  JSON.stringify({ ...apiPkg, dependencies }, null, 2),
  "utf8",
);

console.log("4. Installing isolated production dependencies in staging bundle...");
execSync("npm install --omit=dev", { cwd: deployDir, stdio: "inherit" });

console.log(`5. Publishing to Azure Function App: ${appName}...`);
execSync(`func azure functionapp publish ${appName} --javascript --no-build`, {
  cwd: deployDir,
  stdio: "inherit",
});

console.log("Deployment complete!");
