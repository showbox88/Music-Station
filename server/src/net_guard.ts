/**
 * SSRF guard for user-supplied outbound URLs.
 *
 * Resolves the hostname and refuses any URL whose target IP is on a
 * non-public range: loopback, link-local, RFC1918 private, multicast,
 * broadcast, IETF reserved, and the Tailscale CGNAT range 100.64.0.0/10.
 *
 * Used by /api/tracks/:id/cover/url so a logged-in attacker cannot
 * pivot the server into fetching internal services (3X-UI panel, xray
 * API, tailnet peers, cloud metadata, etc.).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipToBytes(ip: string): number[] {
  if (isIP(ip) === 4) return ip.split(".").map((s) => Number(s));
  const full = (() => {
    if (ip.includes("::")) {
      const [head, tail] = ip.split("::");
      const headParts = head ? head.split(":") : [];
      const tailParts = tail ? tail.split(":") : [];
      const missing = 8 - headParts.length - tailParts.length;
      return [...headParts, ...Array(missing).fill("0"), ...tailParts];
    }
    return ip.split(":");
  })();
  const bytes: number[] = [];
  for (const part of full) {
    const v = parseInt(part || "0", 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function isPrivateIPv4(b: number[]): boolean {
  const [a, c] = b;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && c === 254) return true;
  if (a === 172 && c >= 16 && c <= 31) return true;
  if (a === 192 && c === 168) return true;
  if (a === 192 && c === 0) return true;
  if (a === 198 && (c === 18 || c === 19)) return true;
  if (a === 198 && c === 51) return true;
  if (a === 203 && c === 0) return true;
  if (a >= 224) return true;
  if (a === 100 && c >= 64 && c <= 127) return true;
  return false;
}

function isPrivateIPv6(b: number[]): boolean {
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true;
  if (b.every((x) => x === 0)) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  if ((b[0] & 0xfe) === 0xfc) return true;
  if (b[0] === 0xff) return true;
  if (
    b.slice(0, 10).every((x) => x === 0) &&
    b[10] === 0xff &&
    b[11] === 0xff
  ) {
    return isPrivateIPv4(b.slice(12, 16));
  }
  if (b[0] === 0xfd && b[1] === 0x7a && b[2] === 0x11 && b[3] === 0x5c && b[4] === 0xa1 && b[5] === 0xe0) return true;
  return false;
}

function isPrivateIP(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 0) return true;
  const bytes = ipToBytes(ip);
  return fam === 4 ? isPrivateIPv4(bytes) : isPrivateIPv6(bytes);
}

export async function assertPublicUrl(urlStr: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("only http/https allowed");
  }
  if (u.username || u.password) {
    throw new Error("url must not contain credentials");
  }
  const host = u.hostname;
  if (!host) throw new Error("url missing host");
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dnsLookup(host, { all: true });
  } catch (e: any) {
    throw new Error(`dns lookup failed: ${e?.code ?? e?.message ?? e}`);
  }
  if (addrs.length === 0) throw new Error("host did not resolve");
  for (const { address } of addrs) {
    if (isPrivateIP(address)) {
      throw new Error(`refusing to fetch private/internal address (${address})`);
    }
  }
}
