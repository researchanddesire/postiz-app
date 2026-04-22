import { parse } from 'tldts';

export function getCookieUrlFromDomain(domain: string) {
  // allowPrivateDomains lets tldts recognise entries like `fly.dev`,
  // `vercel.app`, `github.io`, etc. as public suffixes. Browsers refuse to
  // accept a cookie whose Domain attribute is itself a public suffix, so in
  // those cases we must bind the cookie to the full hostname instead of the
  // registrable domain.
  const url = parse(domain, { allowPrivateDomains: true });
  if (!url.domain || url.domain === url.publicSuffix) {
    return url.hostname!;
  }
  return '.' + url.domain;
}
