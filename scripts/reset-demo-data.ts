/**
 * Resets DEMO data in Cosmos DB: backs up then deletes all bookings and frees all seats.
 * Events are left untouched. Destructive, so it requires --yes.
 *
 *   COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/ \
 *     npx tsx scripts/reset-demo-data.ts --yes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

const endpoint = process.env.COSMOS_ENDPOINT?.trim();
const databaseName = process.env.COSMOS_DATABASE?.trim() || "ticketing";

if (!endpoint) {
  throw new Error("Set COSMOS_ENDPOINT.");
}

if (!process.argv.includes("--yes")) {
  throw new Error("This deletes all bookings and frees all seats. Re-run with --yes to confirm.");
}

async function main(): Promise<void> {
  const database = new CosmosClient({
    endpoint: endpoint as string, // validated non-empty above
    aadCredentials: new DefaultAzureCredential(),
  }).database(databaseName);
  const bookingsContainer = database.container("bookings");
  const seatsContainer = database.container("seats");

  const { resources: bookings } = await bookingsContainer.items.query("SELECT * FROM c").fetchAll();
  const { resources: seats } = await seatsContainer.items.query("SELECT * FROM c").fetchAll();

  // Backup stays local (gitignored location) in case anything needs to be inspected later.
  mkdirSync(".reset-backups", { recursive: true });
  const backupPath = `.reset-backups/backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backupPath, JSON.stringify({ bookings, seats }, null, 2));
  console.log(`Backed up ${bookings.length} bookings and ${seats.length} seats to ${backupPath}`);

  for (const booking of bookings) {
    await bookingsContainer.item(booking.id as string, booking.userId as string).delete();
  }

  let freed = 0;

  for (const seat of seats) {
    if (seat.status === "AVAILABLE" && !seat.bookingId) {
      continue;
    }

    const clean: Record<string, unknown> = { ...seat, status: "AVAILABLE" };

    for (const key of [
      "bookingId",
      "bookedBy",
      "bookedAt",
      "_rid",
      "_self",
      "_etag",
      "_attachments",
      "_ts",
    ]) {
      delete clean[key];
    }

    await seatsContainer.items.upsert(clean);
    freed += 1;
  }

  console.log(`Deleted ${bookings.length} bookings, freed ${freed} seats.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
