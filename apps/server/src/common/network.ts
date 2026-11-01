/**
 * Whether a client address is on the restaurant's own network (P9-14): the PC itself, or a private
 * range (RFC 1918, link-local, IPv6 unique-local), never the internet. IPv4 addresses may come
 * IPv6-mapped (`::ffff:192.168.1.20`).
 */
export function onLocalNetwork(address: string | undefined): boolean {
  if (address === undefined || address === '') return false;
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1') return true;
  const parts = ip.split('.').map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a = -1, b = -1] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  // IPv6: unique-local fc00::/7 and link-local fe80::/10.
  return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}
