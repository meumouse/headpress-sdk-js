/**
 * The shopper's IP behind the proxies in front of the storefront.
 *
 * `X-Forwarded-For` is a list each proxy appends to, so its leftmost entries are whatever the
 * browser sent. Trusting the first hop lets anyone rotate a fake address per request and walk past
 * every per-IP rate limit. The chain is read from the right instead, returning the first hop that
 * is not one of the trusted proxies: loopback and private ranges always, Cloudflare's edge on
 * request, plus any ranges you add.
 */

/** Cloudflare edge ranges (https://www.cloudflare.com/ips/). */
export const CLOUDFLARE_RANGES: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

/** Loopback, private, carrier-grade NAT and link-local ranges: reverse proxies and container networks. */
export const PRIVATE_RANGES: readonly string[] = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

export interface ClientIpOptions {
  /** Extra proxy ranges (CIDR), e.g. a load balancer's public range. */
  trustedProxies?: readonly string[];
  /** Also trust Cloudflare's edge (the storefront is behind Cloudflare). */
  cloudflare?: boolean;
}

interface ParsedIp {
  value: bigint;
  bits: 32 | 128;
}

/** An IPv4 or IPv6 address as a big integer plus its width, or null. */
export function parseIp(raw: string): ParsedIp | null {
  const ip = raw.trim().replace(/^\[|\]$/g, "");

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    return { value: octets.reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n), bits: 32 };
  }

  if (!ip.includes(":") || !/^[0-9a-f:.]+$/i.test(ip)) return null;

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is the IPv4 address for our purposes.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return parseIp(mapped[1]);

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return { value, bits: 128 };
}

function inRange(ip: ParsedIp, cidr: string): boolean {
  const [base = "", prefixRaw] = cidr.split("/");
  const network = parseIp(base);
  if (!network || network.bits !== ip.bits) return false;
  const prefix = BigInt(prefixRaw === undefined ? ip.bits : Number(prefixRaw));
  const shift = BigInt(ip.bits) - prefix;
  return ip.value >> shift === network.value >> shift;
}

/**
 * The rightmost `X-Forwarded-For` hop that is not a trusted proxy, else `X-Real-IP`, else null.
 * Invalid entries are skipped, never returned.
 */
export function clientIp(headers: Headers, options: ClientIpOptions = {}): string | null {
  const trusted = [
    ...PRIVATE_RANGES,
    ...(options.cloudflare ? CLOUDFLARE_RANGES : []),
    ...(options.trustedProxies ?? []),
  ];
  const isTrusted = (ip: ParsedIp): boolean => trusted.some((cidr) => inRange(ip, cidr));

  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  for (let i = chain.length - 1; i >= 0; i--) {
    const hop = chain[i] as string;
    const parsed = parseIp(hop);
    if (parsed && !isTrusted(parsed)) return hop.replace(/^\[|\]$/g, "");
  }

  const real = headers.get("x-real-ip")?.trim() ?? "";
  return real && parseIp(real) ? real : null;
}
