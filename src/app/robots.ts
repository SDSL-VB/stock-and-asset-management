import type { MetadataRoute } from "next";

/**
 * Keeps the whole system out of search engines.
 *
 * Belt and braces with the `X-Robots-Tag` header in `next.config.ts`: the
 * header covers crawlers that ignore this file, this file covers the ones that
 * read it before requesting anything.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
