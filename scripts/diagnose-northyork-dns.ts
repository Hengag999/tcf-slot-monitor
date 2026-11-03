// Read-only public DNS comparison for intermittent CI connection failures.
// Never changes process/runner DNS or reads credentials/availability state.
import { Resolver, lookup } from "node:dns/promises";

const hostname = "api.gblc.ca";
const resolvers = [
  { label: "runner", servers: undefined },
  { label: "google", servers: ["8.8.8.8"] },
  { label: "cloudflare", servers: ["1.1.1.1"] },
];

async function diagnose() {
  await Promise.all(resolvers.map(async ({ label, servers }) => {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    if (servers) resolver.setServers(servers);
    try {
      const answers = await resolver.resolve4(hostname);
      console.log(JSON.stringify({ event: "northyork_public_dns", resolver: label, hostname, answers }));
    } catch {
      // Diagnostic availability must not hide, fail or replace the real scrape.
      console.log(JSON.stringify({ event: "northyork_public_dns", resolver: label, hostname, unavailable: true }));
    }
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), 3000); }),
    ]);
    console.log(JSON.stringify({ event: "northyork_public_dns", resolver: "os-lookup", hostname, answers }));
  } catch {
    console.log(JSON.stringify({ event: "northyork_public_dns", resolver: "os-lookup", hostname, unavailable: true }));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

void diagnose();
