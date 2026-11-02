import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Where an outbound webhook may be sent. The URL is typed by a signed-in user and the server
 * makes the request, so without a check anyone with an account could have the server probe its
 * own network (the reply's status shows on the Developer page, and "Send test" fires on demand).
 *
 * - `blocked`, for everyone: loopback, link-local (which holds cloud metadata services such as
 *   169.254.169.254), unspecified, multicast and reserved addresses. Nothing a webhook is for
 *   lives there; inside a container, loopback is the container itself.
 * - `local`, for server admins only: private ranges (10/8, 172.16/12, 192.168/16, fc00::/7) and
 *   the carrier-grade range Tailscale uses (100.64/10). That is where Home Assistant usually
 *   runs, and the admin already controls the server and its network.
 * - `public`: everything else, https only, since the body is the user's financial data.
 */

export type AddressClass = "public" | "local" | "blocked";

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  return octets.every((n, i) => Number.isInteger(n) && n >= 0 && n <= 255 && /^\d+$/.test(parts[i])) ? octets : null;
}

function classifyIpv4([a, b]: number[]): AddressClass {
  if (a === 0 || a === 127) return "blocked";
  if (a === 169 && b === 254) return "blocked";
  if (a >= 224) return "blocked"; // multicast, reserved, broadcast
  if (a === 10) return "local";
  if (a === 172 && b >= 16 && b <= 31) return "local";
  if (a === 192 && b === 168) return "local";
  if (a === 100 && b >= 64 && b <= 127) return "local";
  return "public";
}

/** Expands an IPv6 address to its eight 16-bit groups; null when it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  // An embedded IPv4 tail (::ffff:10.0.0.1) becomes two groups.
  const v4 = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const octets = ipv4Octets(v4[2]);
    if (!octets) return null;
    text = `${v4[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return groups.some((g) => Number.isNaN(g)) ? null : groups;
}

function classifyIpv6(groups: number[]): AddressClass {
  const [g0] = groups;
  const allZeroUpTo = (n: number) => groups.slice(0, n).every((g) => g === 0);
  if (allZeroUpTo(7) && (groups[7] === 0 || groups[7] === 1)) return "blocked"; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d) and the old IPv4-compatible form: judged as the IPv4 address.
  if (allZeroUpTo(5) && (groups[5] === 0xffff || groups[5] === 0)) {
    return classifyIpv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
  }
  if ((g0 & 0xffc0) === 0xfe80) return "blocked"; // link-local
  if ((g0 & 0xff00) === 0xff00) return "blocked"; // multicast
  if ((g0 & 0xfe00) === 0xfc00) return "local"; // unique local
  return "public";
}

/** How an IP address literal is treated; anything that is not one is `blocked`. */
export function classifyIpAddress(ip: string): AddressClass {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (isIP(bare) === 4) {
    const octets = ipv4Octets(bare);
    return octets ? classifyIpv4(octets) : "blocked";
  }
  if (isIP(bare.replace(/%.*$/, "")) === 6) {
    const groups = ipv6Groups(bare);
    return groups ? classifyIpv6(groups) : "blocked";
  }
  return "blocked";
}

const RANK: Record<AddressClass, number> = { public: 0, local: 1, blocked: 2 };

export type ResolveHost = (hostname: string) => Promise<string[]>;

const resolveWithDns: ResolveHost = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/**
 * The strictest class among every address `hostname` resolves to, so a name that answers with
 * one public and one private address counts as private. Checked when a webhook is saved and
 * again before each delivery, so a name repointed later is caught too.
 */
export async function classifyWebhookHost(hostname: string, resolve: ResolveHost = resolveWithDns): Promise<AddressClass> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare.replace(/%.*$/, ""))) return classifyIpAddress(bare);
  // Names that only ever mean this machine or its private network.
  const lower = bare.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost")) return "blocked";
  let addresses: string[];
  try {
    addresses = await resolve(bare);
  } catch {
    throw new Error(`Could not find ${hostname}. Check the address.`);
  }
  if (addresses.length === 0) throw new Error(`Could not find ${hostname}. Check the address.`);
  return addresses.map(classifyIpAddress).reduce((worst, c) => (RANK[c] > RANK[worst] ? c : worst), "public" as AddressClass);
}

/**
 * Throws with a message for the person when `url` is not somewhere this user may send a
 * webhook: a blocked address for anyone, a local one unless they are a server admin, and plain
 * http unless the address is local.
 */
export async function assertWebhookDestination(
  url: string,
  options: { allowLocal: boolean; resolve?: ResolveHost },
): Promise<void> {
  const parsed = new URL(url);
  const kind = await classifyWebhookHost(parsed.hostname, options.resolve);
  if (kind === "blocked") {
    throw new Error("Webhooks cannot be sent to this server itself or to link-local addresses.");
  }
  if (kind === "local" && !options.allowLocal) {
    throw new Error("Only a server admin can send webhooks to addresses on the local network. Use a public https URL.");
  }
  if (kind === "public" && parsed.protocol !== "https:") {
    throw new Error("Use https:// for a webhook on the internet: the requests carry your financial data.");
  }
}
