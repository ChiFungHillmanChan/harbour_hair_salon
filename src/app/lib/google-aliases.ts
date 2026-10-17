/**
 * A stylist's extra diary names (Admin → Stylists → Google names): split on
 * English or Chinese commas and 、, trimmed, empty ones dropped, repeats
 * (ignoring case) dropped. Pure; shared by the form and the classifier.
 */
export function parseGoogleAliases(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const part of text.split(/[,，、]/)) {
    const alias = part.trim();
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}
