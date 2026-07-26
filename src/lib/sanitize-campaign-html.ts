/**
 * Sanitiser for campaign content rendered onto a public web page.
 *
 * `editor_html` and `editor_css` are authored in the dashboard by workspace
 * users and were interpolated raw into two public routes — /newsletter/[slug]
 * and /web/[id]. Both serve HTML from the shared newsletter-core origin, and
 * the archive page is marked `robots: index, follow`, so any workspace editor
 * could publish executing script onto a search-indexed page on a domain every
 * tenant shares.
 *
 * The frontend already sanitises the same content with DOMPurify when it
 * renders an archive client-side (PublicNewsletterPage.jsx). These routes are
 * the server-rendered path of the same data and had no equivalent.
 *
 * Sanitising on read rather than on write is deliberate: content stored before
 * this existed is still untrusted, and a write-side filter would leave it
 * dangerous. A write-side pass is worth adding too, but it cannot replace this
 * one.
 *
 * Note this is NOT applied to the email path. Mail clients do not execute
 * script, and stripping tags there risks mangling legitimate campaign markup
 * for no security gain.
 */

import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "b", "blockquote", "br", "caption", "code", "div", "em", "figcaption",
    "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li",
    "ol", "p", "pre", "s", "small", "span", "strike", "strong", "sub", "sup",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel", "title", "style"],
    img: ["src", "alt", "title", "width", "height", "style"],
    td: ["colspan", "rowspan", "align", "valign", "width", "style"],
    th: ["colspan", "rowspan", "align", "valign", "width", "style"],
    table: ["width", "cellpadding", "cellspacing", "border", "align", "style"],
    "*": ["class", "style", "align", "dir", "lang"],
  },
  // http/https/mailto/tel only — blocks javascript: and data: URLs in href.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // Images may be inlined as data URIs; script cannot execute from an <img src>.
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  // Anything not on the allowlist loses its tag but keeps its text, so
  // stripping never silently blanks a newsletter.
  disallowedTagsMode: "discard",
  transformTags: {
    // Campaign links open away from the archive; noopener denies the opened
    // page access to window.opener.
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
};

/** Sanitise campaign body HTML for rendering on a public page. */
export function sanitizeCampaignHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, OPTIONS);
}

/**
 * Make author-supplied CSS safe to place inside a <style> element.
 *
 * The only escape from a style block is a literal `</style>`, so `<` is
 * replaced with its CSS escape. `>` is left alone — it is the child
 * combinator and is needed by real stylesheets — and `<` has no valid
 * unquoted meaning in CSS, so nothing legitimate is lost.
 *
 * @-rules that can fetch or navigate are dropped as well: they cannot execute
 * script, but they can beacon a reader's IP to a third party from a page the
 * reader believes is ours.
 */
export function sanitizeCampaignCss(css: string | null | undefined): string {
  if (!css) return "";
  return css
    .replace(/</g, "\\3c ")
    .replace(/@import\b/gi, "/* blocked-import */")
    .replace(/\bbehavior\s*:/gi, "/* blocked */:")
    .replace(/\bexpression\s*\(/gi, "/* blocked */(");
}
