import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { isIPv4, type LookupFunction } from "node:net";

export const NORTH_YORK_API_URL = "https://api.gblc.ca/candidates/test-schedules/?test_id=6&has_available_seats=true";
export type NorthYorkApiResponse = Pick<Response, "ok" | "status" | "json">;

// An isolated resolver is used only after the ordinary API GET cannot connect.
// Never changes global DNS, pins an API IP, or weakens HTTPS identity checks.
export function northYorkLookup(resolve4?: (hostname: string) => Promise<string[]>): LookupFunction {
  if (!resolve4) {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(["8.8.8.8"]);
    resolve4 = hostname => resolver.resolve4(hostname);
  }
  return (hostname, options, callback) => {
    if (hostname !== "api.gblc.ca") {
      callback(new Error("GBLC: unexpected DNS lookup target"), "", 4);
      return;
    }
    void resolve4!(hostname).then(addresses => {
      if (!addresses.length || !addresses.every(isIPv4)) throw new Error("GBLC: invalid DNS answer");
      if (options.all) callback(null, addresses.map(address => ({ address, family: 4 })));
      else callback(null, addresses[0], 4);
    }).catch(() => callback(new Error("GBLC: public DNS lookup failed"), "", 4));
  };
}

export function fetchNorthYorkViaPublicDns(signal: AbortSignal, options: {
  requestImpl?: typeof request;
  resolve4?: (hostname: string) => Promise<string[]>;
} = {}): Promise<NorthYorkApiResponse> {
  return new Promise((resolve, reject) => {
    const req = (options.requestImpl ?? request)(NORTH_YORK_API_URL, {
      method: "GET",
      lookup: northYorkLookup(options.resolve4),
      signal,
      agent: false,
      servername: "api.gblc.ca",
      rejectUnauthorized: true,
      headers: { Accept: "application/json" },
    }, response => {
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("GBLC: incomplete API response")));
      const status = response.statusCode ?? 0;
      const ok = status >= 200 && status < 300;
      if (!ok) {
        // Node's HTTPS client never follows redirects. Leave every HTTP error
        // to the caller's existing immediate-failure policy.
        response.resume();
        resolve({ ok, status, json: async () => { throw new Error("GBLC: unsuccessful HTTP response"); } });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_000_000) {
          response.destroy(new Error("GBLC: API response exceeds bounded inventory size"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (!response.complete) { reject(new Error("GBLC: incomplete API response")); return; }
        resolve({ ok, status, json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
