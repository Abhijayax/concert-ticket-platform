import { execSync } from "node:child_process";
import { resolve } from "node:path";

const rootDir = process.cwd();
const webDir = resolve(rootDir, "apps/web");

const storageAccount = process.env.AZURE_STORAGE_ACCOUNT || "concertticketst0u1e9n";
const apiBaseUrl =
  process.env.VITE_API_BASE_URL || "https://concertticket-api-0u1e9n.azurewebsites.net/api";

console.log("1. Building frontend with VITE_API_BASE_URL=" + apiBaseUrl + "...");
execSync("npx vite build", {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, VITE_API_BASE_URL: apiBaseUrl },
});

console.log(
  `2. Uploading static files to Azure Storage account: ${storageAccount} container: $web...`,
);
execSync(
  `az storage blob upload-batch --source dist --destination '$web' --account-name ${storageAccount} --auth-mode key --overwrite`,
  {
    cwd: webDir,
    stdio: "inherit",
  },
);

const webEndpoint = `https://${storageAccount}.z58.web.core.windows.net/`;
console.log(`\nFrontend deployment complete!`);
console.log(`Static Website URL: ${webEndpoint}`);
