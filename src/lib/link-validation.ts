export function extractLinksFromHtml(html: string): string[] {
  const links = new Set<string>();
  const urlRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = urlRegex.exec(html)) !== null) {
    const url = match[1].trim();
    if (url && !url.startsWith("{{") && !url.startsWith("#")) {
      links.add(url);
    }
  }

  return Array.from(links);
}

export function checkUnsubscribeTag(html: string): boolean {
  return /\{\{unsubscribe_url\}\}/.test(html);
}

export async function validateLinks(urls: string[]): Promise<{ url: string; valid: boolean; statusCode?: number }[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 5000)
        );

        const fetchPromise = fetch(url, { method: "HEAD" });
        const response = (await Promise.race([fetchPromise, timeoutPromise])) as Response;

        return {
          url,
          valid: response.ok,
          statusCode: response.status,
        };
      } catch {
        return {
          url,
          valid: false,
        };
      }
    })
  );

  return results;
}
