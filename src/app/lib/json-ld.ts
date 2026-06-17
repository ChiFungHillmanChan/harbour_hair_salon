/**
 * Serialize data for safe embedding inside a
 * `<script type="application/ld+json">` block.
 *
 * `JSON.stringify` does NOT escape `<`, `>` or `&`, so a user-controlled value
 * (e.g. a review comment or username) containing `</script><script>…` would
 * break out of the script tag and execute (stored XSS). Escaping those three
 * characters to Unicode escapes keeps the output valid JSON while making a tag
 * breakout impossible.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(
    /[<>&]/g,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}
