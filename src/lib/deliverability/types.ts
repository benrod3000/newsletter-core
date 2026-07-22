/**
 * Deliverability types.
 *
 * DNS checking, health scoring, and deliverability overview types.
 * All DNS resolution uses Node.js built-in `dns` module — zero dependencies.
 */

/** Status of a single DNS record check */
export type DnsStatus = 'pass' | 'warning' | 'fail' | 'unknown';

/** Result of checking a single DNS record type */
export interface DnsCheckResult {
  /** pass | warning | fail | unknown */
  status: DnsStatus;
  /** Human-readable label (e.g. "SPF", "DKIM (s1._domainkey)") */
  label: string;
  /** The actual value found in DNS, if any */
  value: string | null;
  /** What the record should contain (e.g. "include:sendgrid.net") */
  expected: string | null;
  /** Human-readable explanation of the result */
  message: string;
}

/** Full DNS health report for a domain */
export interface DnsHealthReport {
  domain: string;
  checkedAt: string;
  spf: DnsCheckResult;
  dkim: DnsCheckResult;
  dmarc: DnsCheckResult;
  mx: DnsCheckResult;
}

/** A single actionable recommendation */
export interface Recommendation {
  /** priority: 1 = critical, 2 = important, 3 = nice-to-have */
  priority: 1 | 2 | 3;
  /** Category for grouping */
  category: 'dns' | 'bounces' | 'complaints' | 'general';
  /** Human-readable title */
  title: string;
  /** Detailed explanation with actionable steps */
  description: string;
}

/** Full deliverability overview returned by the API */
export interface DeliverabilityOverview {
  /** 0–100 overall score */
  score: number;
  /** 0–100 DNS health sub-score */
  dnsScore: number;
  /** 0–100 bounce health sub-score */
  bounceScore: number;
  /** 0–100 complaint health sub-score */
  complaintScore: number;
  /** DNS health breakdown by record type */
  dnsHealth: DnsHealthReport;
  /** Bounce rate as a decimal (0.02 = 2%) */
  bounceRate: number;
  /** Complaint rate as a decimal (0.001 = 0.1%) */
  complaintRate: number;
  /** Total sends in the evaluation window (last 30 days) */
  totalSends: number;
  /** Prioritized list of recommendations */
  recommendations: Recommendation[];
}

/** DNS check response for a custom domain */
export interface DnsCheckResponse {
  domain: string;
  checkedAt: string;
  provider: string;
  spf: DnsCheckResult;
  dkim: DnsCheckResult;
  dmarc: DnsCheckResult;
  mx: DnsCheckResult;
}
