/**
 * The address presenters and board members are sent to. APP_URL is set
 * deliberately; Netlify's own URL follows whatever domain happens to be
 * primary, which once minted links to a domain that was removed an hour later.
 */
export function siteUrl(req) {
  const configured = process.env.APP_URL || process.env.URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}
