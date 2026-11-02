/** IPv6 literals and dotted IPv4 hostnames; callers reject both. */
export function isIpHostname(hostname: string): boolean {
  if (hostname.includes(":")) return true;
  return /^\d+(\.\d+){3}$/.test(hostname);
}
