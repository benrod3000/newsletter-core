# Veloce — Architecture

_Target architecture and migration plan. Written 2026-07-26. Covers both repos:
`newsletter` (frontend) and `newsletter-core` (backend/API)._

Veloce is an **operating system for audience ownership**, not an email marketing
platform. Email is the first channel, not the product. This document is the
reference for decisions that are expensive or impossible to reverse.

Read [`CLAUDE-HANDOFF.md`](../newsletter/CLAUDE-HANDOFF.md) for current working state.

---

## 0. The constraint

Veloce is built by one person. The feature ambition — email, SMS, RCS, push,
WhatsApp, webhooks, APIs, automation, AI, enterprise, white-label, multi-region —
is a decade of work for a team of thirty. So the design question is never "how do
I support all of this," it is:

> **What is the minimum set of primitives such that most of this gets built by
> someone other than me, or bought rather than built?**

That reframing sets the priorities below. The API platform is early-stage, not
late, because it is how a solo developer gets leverage. Identity federation is
purchased. Multi-region is a routing table, not an infrastructure project.

### The three decisions that foreclose the most future

1. **Tenancy shape** — Organization → Workspace → Membership, enforced by RLS.
2. **Event envelope** — one append-only log, many consumers.
3. **Delivery record** — one send pipeline, every channel flows through it.

Get these right and the next decade is additive. Get them wrong and every feature
becomes a migration.

### What must not be rewritten

A first-principles redesign lands in the same place as these, which is the
strongest signal available:

- `campaign_job_recipients` + claim-with-`FOR UPDATE SKIP LOCKED` (migration 044).
  The correct durable-work primitive. It generalises directly into the journey
  engine and the webhook dispatcher.
- The transport registry and `EmailTransport` interface. The shape is right; only
  the payload is email-shaped.
- The audit-log and consent-capture foundations.

---

## 1. Invariants

Violating one of these is how the architecture rots.

1. **Every row carries `workspace_id`, and RLS enforces it.** Isolation is a
   database property, never a code convention.
2. **Business logic never lives in a route handler.** A handler parses,
   authorizes, delegates, serializes. This is what makes moving work to a
   background worker a deployment change rather than a rewrite.
3. **Every state change emits its event in the same transaction** (transactional
   outbox). No state without history, no history without state.
4. **Consent and suppression are checked at dispatch**, not only at audience
   build. Time passes between deciding to send and sending.
5. **Nothing with compliance meaning is deleted.** It is tombstoned.
6. **The API contract is generated, never hand-maintained.**
7. **What was sent must be reconstructible forever.** Content versions are
   immutable; a send references a version, not a mutable template.
8. **The pipeline is shared; the payload is not.** Channels genuinely differ.
9. **Buy identity federation. Build the domain.**
10. **Every async worker is a plain function.** Where it runs is a deployment
    detail.

---

## 2. Domain model

### The three-way identity split

Conflating these is the most common structural error in this category of product.

| Concept | Is | Scope |
| --- | --- | --- |
| **User** | a human who logs into Veloce | global |
| **Person** | a human in a workspace's audience | **workspace** |
| **ChannelIdentity** | one way to reach a Person on one channel | workspace |

### Entities

**Organization** — the commercial and identity-federation boundary. Owns billing,
plan/entitlements, SSO/SCIM config, verified domains, residency region. Created at
signup *always*, even for a single self-serve user, even when no UI shows it.
Retrofitting the top of the tenancy tree touches every foreign key and every token.

**Workspace** — the **data controller boundary**, and therefore the tenancy, RLS,
and residency boundary. Under GDPR each workspace is a distinct controller, which
has a hard consequence: **audience data is never joined across workspaces.**

**User** — an authenticated operator. Credentials delegated to an identity
provider. Deactivation must revoke sessions immediately.

**Membership** — User × (Org | Workspace) → Role. The single answer to "may this
actor do this here?" Replaces the baked-in `workspaceId` JWT claim: the token
identifies the *user*, the path identifies the workspace, Membership authorizes.

**Person** — the durable record of a relationship with a human. Not an email
address. Holds profile attributes, computed traits, lifecycle state, source.
**Always workspace-scoped** — cross-workspace identity resolution is a legal
problem, not a feature.

**ChannelIdentity** — one reachable endpoint: email address, phone number, push
token, WhatsApp ID. Carries verification state, **consent state**, **suppression
state**, unsubscribe token, provider metadata.

> The single most important structural change. Consent, suppression and
> verification are properties of *(person, channel, address)* — not of a person,
> and certainly not of a row that gets deleted.

**ConsentRecord** — append-only legal proof: exact text, version, timestamp,
IP/UA, mechanism, scope. Current consent is a projection over these.

**Segment** — the only audience abstraction, and the addressable unit for every
send. Dynamic (a predicate) or static (an explicit set); both addressed
identically. Collapses today's `subscriber_lists`, `saved_segments`,
`subscriber_tags` and inline geo params. **Tag becomes a Person attribute** that
predicates reference. *Audience is not an entity — it is the aggregate.*

**Content / ContentVersion** — Content is the mutable editing surface;
**ContentVersion is immutable and is what a send references.** Per-channel
variants live here, which is what makes channel a *decision* rather than a fact.

**Campaign** — a one-time broadcast: this content, to this segment, at this time.

**Journey / JourneyVersion / JourneyRun** — a versioned automation graph, and one
Person's traversal of it. In-flight runs pin to the version they entered.

**Delivery** — **the universal spine.** One record per "we attempted to deliver
this content to this identity via this provider." Channel, person,
channel_identity, content_version, source (`campaign` | `journey` |
`transactional` | `api` | `intent`), provider, provider message id, status,
attempts, timestamps, failure classification, **and the policy decision that
produced it** (see §8).

> Every channel produces Deliveries; every engagement event references one. This
> is what buys cross-channel analytics, frequency capping, one retry engine and
> one reporting surface — for free.

**Event** — an immutable fact. The system's memory and its nervous system.

**Connection** — a configured link to an external system (ESP, SMS provider, CRM,
warehouse). Encrypted credentials, capability declaration, health, routing
eligibility.

**Domain** — a customer-controlled domain with **purposes**, commonly conflated
but genuinely distinct:
- **Sending** — DKIM/SPF/DMARC alignment. Deliverability-critical.
- **Tracking** — the click/open domain. Deliverability-critical **and a one-way
  door**: links live in inboxes forever.
- **Hosting** — public archive and landing pages. Branding.

**ApiKey / Credential** — a non-human actor. Hashed, prefixed, scoped, expiring,
rotatable. **A key can never exceed the permissions of its creator.**

**AuditLogEntry** — control-plane accountability.

> **Do not merge the audit log with the event stream.** They differ in volume
> (thousands vs billions), retention (legally fixed vs tiered), access control
> (compliance-restricted vs product-facing) and consumers (auditors vs product).

**Asset** — uploaded media, CDN-served, servable from a customer domain.

---

## 3. Bounded contexts

The value is in the *does not own* column — that is where architectures leak.

| Context | Owns | Does **not** own |
| --- | --- | --- |
| **Identity & Access** | Users, Orgs, Workspaces, Memberships, roles, sessions, API keys, SSO/SCIM, revocation | Persons. This context is about operators, never audiences |
| **Audience** | Persons, ChannelIdentities, Consent, suppression, Segments, attributes, imports, GDPR erasure | Content, delivery, provider selection |
| **Content** | Content, ContentVersions, Assets, rendering, personalization, per-channel variants | Who receives anything |
| **Messaging & Delivery** | Campaigns, Deliveries, transports, provider routing, retries, rate shaping, frequency capping, quiet hours, tracking ingestion | Consent decisions (asks Audience), quota (asks Billing) |
| **Automation** | Journeys, versions, runs, triggers, scheduler, goals | Sending — it *requests* a Delivery |
| **Events & Analytics** | Ingestion, the log, schema registry, rollups, reporting, export, attribution | Business decisions |
| **Deliverability** | Domain auth, reputation, bounce/complaint classification, feedback loops, warmup, health scoring | Sending. It advises and constrains Messaging |
| **Integrations** | Connections, inbound/outbound webhooks, CRM/warehouse sync, OAuth apps | The core domain. Everything translates at the boundary |
| **Billing & Entitlements** | Plans, quotas, metering, invoices, plan-gated flags | Sending mechanics |

**Audience is the sole authority on whether a Person may be contacted on a
channel.** Messaging asks; it never decides.

**The sending quota belongs to Billing**, not Messaging. It currently lives in the
send path (`src/lib/sending-limits.ts`) — acceptable for now; note where it goes.

### AI is not a bounded context

It is (a) a shared **Inference Gateway** owning provider calls, retries, caching,
prompt versioning, per-workspace cost attribution and eval hooks, plus (b)
features owned by the contexts they serve: subject lines → Content, segment
suggestion → Audience, send-time optimization → Deliverability.

Two rules: **AI is an actor, not a bypass** — it authenticates, carries scopes,
emits events and appears in the audit log like a human. And **the event stream is
the feature store** — done properly, AI features are queries, not a data
engineering project.

---

## 4. Data architecture

**Stay on Postgres.** One logical database per region. Partitioning, `jsonb` +
GIN, and materialized rollups reach a scale you will be delighted to hit.

### Two halves, designed oppositely

**Control plane — normalize hard.** Orgs, Workspaces, Users, Memberships, Persons,
ChannelIdentities, Segments, Content, Journeys, Connections, Domains. Small,
relational, correctness-critical. Full FK/check/unique constraints.

**Data plane — denormalize deliberately.** Events, Deliveries, JourneyRuns,
rollups.
- **No foreign keys on hot append tables** — FK checks cost write throughput and
  couple locks to the control plane. Enforce integrity in the write path.
- **Denormalize read keys onto the row** so reports never join to find them.
- **`jsonb` for the open-ended tail**, GIN-indexed, and **promote hot predicates
  to real columns** when segments use them often.

### Partitioning and retention

`events` and `deliveries` partitioned **by month**, `workspace_id` first in every
index. Retention drops partitions; never `DELETE` (a billion-row delete is an
outage, a `DROP` is instant). Tier: hot in Postgres ~90 days, cold to object
storage/warehouse.

**Design the partitioning now; implement it at volume.** Retrofitting onto a large
live table is painful; writing it against a small one is trivial.

### Rollups, not scans

Incremental aggregates keyed `(workspace_id, date_hour, campaign_id, channel,
event_type)`. **Dashboards must never touch raw events.**

> Today `analytics/route.ts` pulls up to 50,000 event rows into Node per dashboard
> load, dedupes by email in a `Map<string, Set<string>>`, then reports
> `truncated: true` with wrong numbers past the cap. The fix is structural, not a
> better query — and it should be written against the new `events` table so it is
> only written once.

### Keys

- **UUIDv7** — time-ordered, so append-table index locality is good.
- **Public IDs are prefixed and opaque** (`per_`, `cmp_`, `dlv_`).
- **Natural keys for idempotency**: `(campaign_id, person_id)`,
  `(journey_run_id, node_id)` unique. This is how exactly-once is actually
  achieved.

### Multi-region is region-pinned tenancy

Not distributed writes. A complete independent stack per region; a Workspace
pinned to one region at creation; a small globally-replicated table mapping
`workspace_id → region`. **No cross-region queries, ever.**

Cost today: a `region` column and the discipline of never writing a cross-workspace
query. Cost retrofitted after EU customers land: a migration that cannot be done
without downtime, plus a legal problem in the interim.

### Standing rules

- Store UTC; carry workspace timezone separately for scheduling and report days.
- Encrypt provider credentials with envelope encryption. *Migration 022 currently
  comments that `ses_access_key` is "encrypted at rest by Supabase Vault or
  app-level". It is not. Make it true or delete the comment.*
- **Every migration is expand → backfill → contract.** Never a breaking schema
  change in the same deploy as the code that needs it.

---

## 5. Event system

### Event-driven, not event-sourced

Events are an immutable append-only log written in the **same transaction** as the
state change (transactional outbox). **State tables remain the source of truth.**
Full event sourcing — rebuilding entity state by replay — is where small teams
lose years.

### Envelope

| Field | Purpose |
| --- | --- |
| `id` | UUIDv7 |
| `workspace_id` | tenancy, on every event without exception |
| `type` | `noun.verb`, past tense, namespaced |
| `schema_version` | consumers branch on it |
| `occurred_at` / `received_at` | real-world vs ingestion time — **both**, because late-arriving provider and mobile events are routine |
| `actor` | `{type: user\|system\|api_key\|journey\|ai, id}` |
| `subject` | `{person_id?, delivery_id?, campaign_id?, journey_run_id?}` |
| `properties` | `jsonb` |
| `source` | `system` \| `api` \| `provider_webhook` \| `import` |
| `idempotency_key` | dedupe under at-least-once ingestion |

### Naming: channel is a property, never part of the name

**`message.clicked` with `{channel: "sms"}` — not `sms.clicked`.**

With channel-in-name, every consumer must enumerate channels: "clicked anything in
30 days" becomes `email.clicked OR sms.clicked OR rcs.clicked OR …` and silently
goes stale the day a channel is added. Every dashboard, journey trigger and
webhook filter carries the same bug. With channel as a property, cross-channel
questions are the default and new channels join existing analytics on day one.

Reserve system namespaces (`person.*`, `message.*`, `journey.*`, `segment.*`,
`campaign.*`, `consent.*`, `workspace.*`); customer events live under their own.

`segment.entered` / `segment.exited` are *derived* events — they are what make
"when someone becomes a VIP, start this journey" possible without polling.

### One log, six consumers

Analytics (rollups) · Segmentation (membership) · Automation (wake runs, evaluate
goals) · Webhooks (fan-out) · AI (feature store) · Export (warehouse).

**At-least-once delivery; all consumers idempotent.** Do not chase exactly-once.
Making replay safe turns rebuilding a corrupted rollup into a routine operation.

**Substrate:** Postgres (outbox + `SKIP LOCKED`) is sufficient for years. Adopt a
broker for a concrete reason, not a theoretical one.

**Once webhooks ship, event schemas are a public API.** Additive changes only.

---

## 6. Messaging

### Abstract the pipeline, not the payload

```
Resolve audience → Check eligibility → Render → Route to provider
    → Dispatch → Track → Reconcile
```

Identical for every channel; exists exactly once. The payload is not identical,
and pretending otherwise is where naive abstractions break.

| Channel | The constraint that breaks a naive abstraction |
| --- | --- |
| Email | MIME, HTML rendering, `List-Unsubscribe`, opens unreliable (proxy prefetch) |
| SMS | 160/70-char segments (GSM-7 vs UCS-2) drive **per-segment cost**; no open tracking; carrier filtering |
| RCS | Rich cards, carousels, suggested replies — **structured payloads, not a body string**; SMS fallback mandatory |
| Push | Tokens expire and rotate; per-device not per-person; silent-failure-heavy |
| WhatsApp | **Pre-approved templates only** outside a 24h window; per-conversation pricing |
| Webhook | Destination is a system, not a person; different retry economics and retention |

> **Design against WhatsApp now, even if it ships last.** Its constraints —
> template pre-approval, session windows, conversation billing — break any
> abstraction assuming content is free-form and sending is always permitted. If
> the model handles WhatsApp on paper it handles everything else.

### Structure

- **Channel Capability Descriptor** — payload schema, size limits, template
  pre-registration, session windows, supported tracking, fallback channel. The
  pipeline reads capabilities rather than branching on channel names.
- **ChannelPayload** — a discriminated union validated at *authoring* time.
- **ChannelTransport** — today's `EmailTransport`, generalized. The registry
  pattern carries over unchanged.
- **Provider routing** — per workspace and channel, ordered by rules (region,
  cost, volume, warmup) with health-based circuit breaking and fallback.

### Cross-channel concerns, only possible with one Delivery table

Frequency capping across all channels · quiet hours in the person's timezone ·
channel preference and fallback · deduplication between campaign and journey ·
unified funnel reporting.

**The current SMS stack is a parallel fork** (`campaigns/sms`, `analytics/sms`,
`sms/test`, `public/sms/webhook`) sharing none of the queue, dispatcher, retry
logic or analytics. It is four files deep. Unify before it is forty.

---

## 7. Automation

**Build the journey engine. Do not adopt a general workflow engine** for
customer-facing journeys. Four domain requirements a general engine fights:

1. **Reportability** — "how many people are at node 4" is a core product screen.
2. **Bulk mutation** — "remove everyone in this branch" needs rows, not opaque
   instances.
3. **Cost at rest** — millions of runs idle for days. A row with `next_wake_at`
   costs nothing.
4. **Versioning semantics are a product decision** you need to own.

**And the right primitive already exists:** `campaign_job_recipients` +
claim-with-`SKIP LOCKED` + idempotent execution is the journey engine's core loop.

**Nodes:** Trigger · Wait (duration | absolute | person-local time | until event
with timeout | until condition) · Branch (conditional, multivariate, random split,
wait-for-first) · Action (send, update attribute, tag, webhook, enter journey,
exit) · Goal · Merge.

**Scheduler:** index `(next_wake_at) WHERE status = 'active'`, claim with
`SKIP LOCKED`, execute one node, compute next wake, commit. Event-driven
advancement is the second path: waiting runs register interest, the event consumer
wakes matches. Both converge on one node executor.

**The hard parts, named:** version pinning for in-flight runs (prefer *drain* over
*migrate*) · re-entry rules (default no — getting this wrong produces duplicate
sends) · idempotency on `(run, node)` · re-evaluate conditions at wake time, never
at entry · **poison runs dead-letter into a UI-visible state with bulk retry**
(silent failure destroys trust faster than any other bug class) · node-level
rollups · dry-run against a synthetic person.

**Note:** `/api/admin/automations/process` has no cron entry in `vercel.json`. The
generic automation engine currently has no trigger.

---

## 8. Intent (the direction of travel)

Over five years the object a user authors moves up a level. Rather than building a
campaign, they declare an outcome — *"everyone interested in Product X should know
about this"* — and the system solves for channel, timing, frequency, retry and
follow-up.

```
Intent  →  Plan  →  Campaign / Journey  →  Delivery
(declared) (solved,  (compiled artifact,   (the spine)
           editable)  inspectable)
```

**Campaign becomes a compiled artifact, not a hidden implementation detail.** It
must stay first-class and queryable, because three parties read it: a marketer
overriding the system, an engineer debugging "why did she get two texts," and a
regulator asking what was sent. Compilers keep the intermediate representation for
exactly this reason.

**Nothing below Intent changes** — Campaign and Journey are already only *sources*
of Deliveries in this model. That is what putting Delivery at the centre bought.

**Intent is late, not first.** A solver needs an objective function and a feedback
loop, both downstream of outcome data that does not exist yet. An optimizer with no
data is strictly worse than a marketer with judgment. And consent, per-segment SMS
cost, WhatsApp template approval, quiet hours and frequency caps are **hard
constraints, not preferences** — the system decides *within* a feasible set.

### Four hooks that keep the door open, at ~zero cost

1. **Record the decision, not just the delivery.** A `decision` field on every
   Delivery: which intent, which policy, which channels were considered and
   rejected and why. **The one irreversible item** — free to write today,
   impossible to reconstruct later, and it is the training set.
2. **Goals attach to anything that sends**, not only journeys.
3. **Author messages with per-channel variants**, never channel-specific
   campaigns — otherwise there is nothing left to route.
4. **Eligibility as a service**: *can I reach this person on this channel now, and
   at what cost?* Buried in the send path, a solver cannot reason over it.
   Exposed, **the constraint checker becomes the optimizer's API.**

LLMs flipped which half is hard: parsing fuzzy intent into a structured spec is now
the easy half. The hard half is the constraint model and the feedback loop — which
is Phase 1 and 2 plumbing. The temptation will be to build the demo-able half
first; it would be a toy that cannot be made real without the layer underneath.

---

## 9. API platform

**Versioning** — `/v1/` in the path **plus** a dated revision header
(`Veloce-Version: 2026-07-25`). Path-only versioning accumulates breaking changes
until "v2" is a total rewrite maintained forever in parallel. Dated revisions allow
continuous evolution with per-customer pinning and transformation shims. *The
cheapest moment to establish this is while there are zero integrators.*

**Authentication** — API keys (`vlc_live_…` / `vlc_test_…`, hashed, prefixed,
scoped, rotatable) for server-to-server; OAuth 2.0 for third-party apps acting on
behalf of a user; short-lived tokens for the first-party dashboard. Prefixed keys
are scannable, so leak-detection services can notify you. Test keys route to
sandbox transports and never send.

**Permissions** — scopes intersected with the principal's role, downgraded
automatically when the creator's role is reduced.

**Consistency** — plural nouns · **cursor pagination only** (offset is O(n) *and*
skips/duplicates rows when the set mutates, which for an audience API is
constantly) · one success and one error envelope with stable codes · `request_id`
on every response · **idempotency keys required on POST** · consistent filter and
sort grammar.

**Webhooks** — HMAC over `timestamp + body` with a tolerance window (replay
defence) · versioned payloads reusing the event envelope · at-least-once with
backoff and dead-lettering · per-subscription filters · **a delivery log with
manual replay in the UI**, which removes most integration support load. Reuse the
Delivery retry machinery; separate table (retention and query patterns differ).

**SDKs** — **OpenAPI is the source of truth.** Server types, client SDKs and docs
are outputs; contract tests run in CI.

> This permanently kills the `data.data ?? data` unwrap in the frontend's
> `lib/api.ts`, which exists because 13 of 94 routes use the standard envelope and
> 77 do not.

**Rate limiting** — per key, per workspace, per endpoint class, with separate
budgets for read / write / send. Standard `RateLimit-*` headers. Publish limits.

---

## 10. Enterprise

**Org → Workspaces → Members**, with roles grantable at both levels. Ship a fixed
role set but **implement roles as named bundles of `(action, resource_type)`
permissions from day one** — custom roles then become a data change rather than a
refactor of every check.

**Agency requirements** (an underrated near-term segment): workspace switching
without re-authentication *(blocked today by the single `workspaceId` JWT claim)* ·
consolidated billing · template/asset sharing across workspaces · full UI
white-label.

**SSO and SCIM — buy** (WorkOS or equivalent). SAML has a long history of subtle
signature-validation vulnerabilities and every IdP interprets the spec differently.
**Corollary: migrate off hand-rolled authentication before SSO is needed.** The
current custom JWT correctly avoids the `alg`-confusion trap, but it has no
revocation and it is the wrong place to stand when a deal requires SAML, SCIM,
session policy and IP allowlisting.

**Audit logs** — immutable, exportable (CSV/JSON + SIEM streaming), actor + IP + UA
+ before/after, retention by plan.

**Domain management** — per-workspace, per-purpose, generated DNS records,
**continuous re-verification** (records drift and silently break deliverability),
automated TLS.

> **The tracking domain is the one-way door.** Every send mints links on the
> platform domain that live in inboxes forever and must resolve forever.
> Introducing per-workspace `baseUrl` indirection is small now and an unbounded
> compatibility burden later. **This degrades with every send.**
>
> Related and immediate: `public_slug` uniqueness is currently *global* across
> tenants, so one workspace can permanently squat a slug on every other.

**Also required:** data residency · IP allowlisting · DSAR tooling · DPA and
sub-processor list · SOC 2 Type II · pen test · uptime SLA · sandbox environments.

**RLS is a prerequisite for most of this.** "Isolation is enforced in application
code" does not survive a security questionnaire.

---

## 11. Roadmap

Ordered by **long-term leverage** — how many future decisions each unlocks or
forecloses — not by user-visible value.

### Phase 0 — Foundations
Nothing user-visible ships. Highest-leverage work in this document.

CI · RLS + `withWorkspace()` · Org/Workspace/Membership skeleton · business logic
out of route handlers · OpenAPI + generated client · token revocation ·
`public_slug` scoping.

*Exit test: adding a route cannot introduce a tenant leak, and changing a response
shape cannot silently break the frontend.*

### Phase 1 — Audience model
Person + ChannelIdentity + Consent + Suppression (absorbing the soft-delete fix) ·
Segment as a compiled predicate · event stream + outbox + first rollups.

*Everything downstream reads this. Doing Phase 2+ first means doing it twice.*

### Phase 2 — Messaging spine
Delivery as the universal record · generalize transports to channels · migrate
email onto it, then fold SMS in and delete the parallel stack · frequency capping,
quiet hours, entitlements · **record the policy decision on every Delivery** (§8).

*Exit test: adding a channel is a transport plus a payload schema, not a subsystem.*

### Phase 3 — Platform
Journey engine on the `SKIP LOCKED` primitive · API keys, scopes, webhooks, SDKs,
sandbox, dated versioning.

*Where Veloce stops being a tool and becomes a platform — and where other people
start building things you do not have to.*

### Phase 4 — Enterprise
Orgs UI · permission sets · SSO/SCIM (bought) · audit export · custom domains ·
region pinning · SOC 2. Driven by the first real enterprise deal.

### Phase 5 — Intelligence and scale
Partitioning and tiering · dedicated worker fleet · warehouse export · Intent layer
· AI on the event stream · RCS, WhatsApp, Push · OAuth app ecosystem.

*Every item here is additive because the foundations absorbed the structural cost.
That is the entire point.*

### Start regardless of phase

Two items accrue cost daily: **tracking-domain indirection** (links live in inboxes
forever) and **suppression as a record** (legal exposure, plus churn analytics
permanently lost with every unsubscribe).

---

## 12. Sequencing rules

1. **Never build a feature that writes to a model you are about to replace.**
2. **Expand → backfill → contract, every migration.**
3. **A context is done when adding an instance requires no changes outside it** —
   new channel → transport + schema; new role → a row; new event type → a registry
   entry.
4. **Buy anything that is not audience ownership.**
5. **When choosing between velocity and foundation, ask whether the decision is
   reversible.** Reversible → move fast. One-way (tracking domains, API contracts,
   event schemas, tenancy shape) → slow down.
