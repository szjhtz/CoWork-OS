/**
 * Convert bare domains (domain.tld without path) into markdown links.
 * e.g. "learn.microsoft.com" -> "[learn.microsoft.com](https://learn.microsoft.com)"
 * Only matches when not already inside a link or brackets.
 */
const BARE_DOMAIN_REGEX =
  /(?<!\(|\[|\/)(?:^|(?<=\s))((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?=[\s\])|,;:]|$)/gi;
const COMMON_BARE_DOMAIN_EXCLUSIONS = new Set(["e.g", "i.e"]);

function shouldAutolinkBareDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  if (COMMON_BARE_DOMAIN_EXCLUSIONS.has(normalized)) return false;

  const labels = normalized.split(".").filter(Boolean);
  if (labels.length < 2) return false;

  const firstLabel = labels[0] || "";
  const tld = labels[labels.length - 1] || "";

  if (/^v?\d+$/.test(firstLabel)) return false;
  if (labels.length === 2 && firstLabel.length < 3 && tld.length < 3) return false;

  return true;
}

export function autolinkBareDomains(text: string): string {
  return text.replace(BARE_DOMAIN_REGEX, (_match, domain) => {
    if (!shouldAutolinkBareDomain(domain)) return _match;
    return `[${domain}](https://${domain})`;
  });
}
