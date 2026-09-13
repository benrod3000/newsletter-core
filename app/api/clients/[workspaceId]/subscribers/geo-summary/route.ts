import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { parseGeoAreas, countSubscribersInAreas, fetchGeoClusters } from "@/lib/geo-areas";

/**
 * GET /api/clients/[workspaceId]/subscribers/geo-summary
 *
 * What the radius picker needs to tell the truth, in one request.
 *
 * The picker previously answered both of its questions from the contacts table's
 * current page - fifty rows of 10,312. It plotted those fifty and counted "in
 * range" among them, so dropping a pin on Denver, where 500 contacts live, read
 * "~2 subscribers in range" over a map showing two dots. Both numbers now come
 * from the database.
 *
 * Query params:
 * - areas: lat,lng,radiusMiles;... (or near_lat/near_lng/radius) // optional
 * - precision: cluster rounding in decimal places, default 2 (~1km)
 *
 * Returns: {
 *   clusters: [{ lat, lng, total, active, at_risk, cold }],
 *   plotted: number,   // contacts represented by clusters
 *   inRange: number|null, // exact, null when no areas were given
 * }
 */
export const GET = withWorkspace(async ({ req, ctx }) => {
  const url = new URL(req.url);
  const areas = parseGeoAreas(url.searchParams);

  const rawPrecision = parseInt(url.searchParams.get("precision") ?? "2", 10);
  const precision = Number.isFinite(rawPrecision) ? Math.min(Math.max(rawPrecision, 0), 6) : 2;

  try {
    /*
     * Both together: the clusters do not depend on the areas, but the picker
     * needs them on the same paint, and two round trips from a debounced slider
     * is twice the chance of the count and the map disagreeing on screen.
     */
    const [clusters, inRange] = await Promise.all([
      fetchGeoClusters(ctx.workspaceId, { precision }),
      areas.length > 0 ? countSubscribersInAreas(ctx.workspaceId, areas) : Promise.resolve(null),
    ]);

    const plotted = clusters.reduce((sum, c) => sum + (c.total ?? 0), 0);

    return NextResponse.json({ clusters, plotted, inRange }, { status: 200 });
  } catch (err) {
    logError(err, {
      route: "clients.subscribers.geo-summary",
      workspaceId: ctx.workspaceId,
      areas: areas.length,
    });
    // Deliberately an error rather than an empty summary: a zero here would draw
    // an empty map and a confident "0 subscribers in range".
    return NextResponse.json({ error: "Failed to build geo summary" }, { status: 500 });
  }
});
