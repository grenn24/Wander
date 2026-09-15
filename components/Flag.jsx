/**
 * A country's flag, drawn from public/flags (country-flag-icons, MIT).
 *
 * An image rather than an emoji: Windows has no flag emoji, and shows the two
 * letters instead. Takes the code the server already worked out from the
 * country's name, so the name-to-code table never reaches the browser.
 * Decorative, because the country is always named beside it.
 */
export default function Flag({ code, className }) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  return (
    <img src={`/flags/${code.toLowerCase()}.svg`} alt="" width={18} height={12}
      className={className} decoding="async" />
  );
}
