import { NextRequest, NextResponse } from "next/server";
import { extractLinksFromHtml, validateLinks } from "@/lib/link-validation";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json();
  const { html } = body;

  if (typeof html !== "string") {
    return NextResponse.json({ error: "HTML content is required." }, { status: 400 });
  }

  const links = extractLinksFromHtml(html);
  if (links.length === 0) {
    return NextResponse.json({ links: [], brokenLinks: [] });
  }

  const validationResults = await validateLinks(links);
  const brokenLinks = validationResults.filter((r) => !r.valid);

  return NextResponse.json({
    links,
    validationResults,
    brokenLinks,
  });
}
