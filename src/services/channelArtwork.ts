export function getChannelInitials(name: string): string {
  const withoutCountry = name.trim().replace(/^[a-z]{2}\s*[:|-]\s*/i, '');
  const words = withoutCountry.split(/\s+/).filter(Boolean).filter(word => !/^(?:full|fhd|hd|sd|uhd|4k|\d{3,4}p?)$/i.test(word));
  const first = words[0] || '';
  if (!first) return 'TV';
  const prefix = /^[A-Z\d]{2,4}$/.test(first) ? first : first[0];
  return (prefix + (words[1]?.[0] || '')).toUpperCase();
}

export function isUsableChannelLogo(url: string): boolean {
  if (!url) return false;
  try {
    // The LyngSat website responds to hotlinked artwork with its own branding.
    // Its dedicated logo CDN is separate and remains usable.
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname !== 'lyngsat.com' && !hostname.endsWith('.lyngsat.com');
  } catch {
    return false;
  }
}
