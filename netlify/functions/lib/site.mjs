/**
 * The address presenters and board members are sent to. APP_URL is set
 * deliberately; Netlify's own URL follows whatever domain happens to be
 * primary, which once minted links to a domain that was removed an hour later.
 */
export function siteUrl(req) {
  const configured = process.env.APP_URL || process.env.URL;
  if (configured) return configured.replace(/\/+$/, "");
  // Callers that have no request (the email layout asking for the logo's address)
  // must not bring the whole send down when APP_URL is unset.
  try { return new URL(req.url).origin; } catch { return ""; }
}
