/**
 * archificials-link-rescue
 *
 * Problem
 * Any query string on a Webflow-served path under www.archificials.com
 * returns a Webflow "500 Something unexpected happened" page. Beehiiv
 * appends UTM tracking parameters to every outbound newsletter link by
 * default, which breaks every "Read Full Article" CTA in every newsletter
 * already sent and any future ones while the Webflow bug persists.
 *
 * Fix
 * Intercept requests to /blog-post/* with a query string, strip the query,
 * and 302 to the clean URL. Beehiiv's click tracking fires on
 * mail.beehiiv.com/c/... before this redirect, so campaign attribution in
 * Beehiiv analytics is preserved. The trade-off is that Webflow-side
 * analytics (if any) will not see the UTM params. Acceptable until the
 * underlying Webflow bug is diagnosed and fixed.
 *
 * Scope
 * Bound only to /blog-post/* routes. Assessment routes are already served
 * by a separate Worker and handle query strings correctly. The homepage and
 * other Webflow pages are not currently linked from newsletters, so they
 * are out of scope for this rescue.
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.search) {
      const cleanUrl = new URL(url);
      cleanUrl.search = '';

      return new Response(null, {
        status: 302,
        headers: {
          'Location': cleanUrl.toString(),
          'Cache-Control': 'no-store',
          'X-Rescued-By': 'archificials-link-rescue',
        },
      });
    }

    return fetch(request);
  },
};
