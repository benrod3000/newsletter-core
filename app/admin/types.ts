import type { Tables } from "@/lib/database.types";

/**
 * Row shapes for the admin components, derived from the live schema.
 *
 * These were hand-written interfaces, and that is how the tenancy rename broke six
 * separate consumers without a single compile error. `interface Campaign { client_id:
 * string }` type-checks perfectly forever: it asserts a shape rather than reading
 * one, so when migration 048 renamed the column, `campaign.client_id` became
 * permanently `undefined` and TypeScript went on agreeing it was a `string`.
 *
 * The damage was never a crash. It was a silent wrong answer - the admin mailer
 * leaving the previously selected workspace in place and aiming one tenant's campaign
 * at another's subscribers, and every scoped admin rendering as "global" on the page
 * used to audit access.
 *
 * `Pick<Tables<"campaigns">, ...>` fixes the mechanism rather than the instances:
 * naming a column that no longer exists is now a build failure. Regenerate with
 * `npm run types:generate` after any migration and the next rename fails loudly here
 * instead of quietly in production.
 *
 * Two deliberate exceptions to pure derivation:
 *
 *   - Columns the database stores as free text but the UI treats as a union
 *     (`role`, `status`, `opt_in_type`) are re-narrowed. The schema cannot express
 *     them - there is no CHECK constraint - and the narrower type is worth keeping.
 *   - Fields the API computes and returns alongside the row (`memberCount`,
 *     `lead_magnet_claimed`) are added explicitly, so it stays obvious which fields
 *     come from a table and which are assembled by a route.
 */

export type Role = "owner" | "editor" | "viewer";

/** A workspace, as /api/admin/workspaces lists them. */
export type Workspace = Pick<Tables<"clients">, "id" | "name" | "slug" | "created_at">;

/**
 * A platform admin.
 *
 * `scoped_workspace_id` deliberately kept its name through the tenancy rename: it
 * restricts a platform admin, it does not declare ownership of a tenant. Reading it
 * as `client_id` is what made every scoped admin display as "global".
 */
export type AdminUser = Omit<
  Pick<Tables<"admin_users">, "id" | "username" | "role" | "active" | "scoped_workspace_id" | "created_at">,
  "role"
> & { role: Role };

/** The subset of a campaign the mailer loads. */
export type CampaignRow = Omit<
  Pick<
    Tables<"campaigns">,
    | "id"
    | "workspace_id"
    | "title"
    | "subject"
    | "audience"
    | "status"
    | "editor_html"
    | "editor_css"
    | "plain_text"
    | "scheduled_for"
    | "sent_count"
    | "last_sent_at"
    | "last_test_sent_at"
    | "last_test_recipient"
    | "geo_filter"
    | "updated_at"
  >,
  "status" | "geo_filter"
> & {
  status: "draft" | "scheduled" | "sent";
  geo_filter: CampaignGeoFilter | null;
  /**
   * Computed per campaign by the list route from `campaign_events`, not stored.
   * Optional because only the list endpoint attaches it - a campaign loaded
   * anywhere else has no stats, and the table already guards on `status === "sent"`.
   */
  stats?: CampaignStats;
};

export interface CampaignStats {
  opens: number;
  clicks: number;
  openRate: number;
  clickRate: number;
}

/** `campaigns.geo_filter` is jsonb, so its shape lives here rather than in the schema. */
export interface CampaignGeoFilter {
  country?: string | null;
  regions?: string[];
  cities?: string[];
  region?: string | null;
  city?: string | null;
  center_lat?: number | null;
  center_lng?: number | null;
  radius_km?: number | null;
  radius_value?: number | null;
  radius_unit?: "km" | "mi";
}

/**
 * A subscriber as the admin table shows one.
 *
 * The widest of these types, so the one a rename is most likely to hit: it names
 * twenty columns, any of which becoming `undefined` would show a blank cell rather
 * than fail.
 */
export type SubscriberRow = Pick<
  Tables<"subscribers">,
  | "id"
  | "email"
  | "confirmed"
  | "first_name"
  | "last_name"
  | "date_of_birth"
  | "phone_number"
  | "country"
  | "region"
  | "city"
  | "latitude"
  | "longitude"
  | "timezone"
  | "locale"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "referrer"
  | "landing_path"
  | "created_at"
> & {
  /**
   * Derived in app/admin/page.tsx from `campaign_events` with
   * `tracking_kind = 'lead_magnet'`, not a column. It was permanently false until
   * lead magnets actually began sending, because the click it counts could not
   * happen.
   */
  lead_magnet_claimed: boolean;
};

/** Just enough of a workspace for the mailer's picker. */
export type ClientWorkspace = Pick<Tables<"clients">, "id" | "name" | "slug">;

/** A list, plus the member count the route computes. */
export type SubscriberListRow = Omit<
  Pick<Tables<"subscriber_lists">, "id" | "name" | "description" | "opt_in_type" | "created_at" | "updated_at">,
  "opt_in_type"
> & {
  opt_in_type: "single" | "double";
  memberCount?: number;
};
