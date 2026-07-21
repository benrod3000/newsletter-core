/**
 * Deliverability scoring and recommendations.
 *
 * Simple, transparent scoring model:
 *   Overall (0-100) = DNS×40% + Bounce×30% + Complaint×30%
 *
 * DNS sub-score: average of SPF/DKIM/DMARC/MX (pass=100, warning=50, fail=0).
 * Bounce sub-score: linearly decreases from 100 at 0% to 0 at 10%.
 * Complaint sub-score: linearly decreases from 100 at 0% to 0 at 0.5%.
 */

import type { DnsCheckResult, DnsHealthReport, Recommendation } from './types';

// ── DNS scoring ──

function dnsResultToScore(result: DnsCheckResult): number {
  switch (result.status) {
    case 'pass': return 100;
    case 'warning': return 50;
    case 'fail': return 0;
    case 'unknown': return 50; // neutral — don't penalize what we can't check
  }
}

/** Calculate DNS health sub-score (0–100) */
export function calculateDnsScore(report: DnsHealthReport): number {
  const scores = [
    dnsResultToScore(report.spf),
    dnsResultToScore(report.dkim),
    dnsResultToScore(report.dmarc),
    dnsResultToScore(report.mx),
  ];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg);
}

// ── Bounce & complaint scoring ──

/** Calculate bounce health sub-score (0–100).
 *  0% bounces = 100, 10%+ bounces = 0. Linear between. */
export function calculateBounceScore(bounceRate: number): number {
  if (bounceRate < 0) bounceRate = 0;
  const score = 100 - bounceRate * 1000; // 10% → 0
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Calculate complaint health sub-score (0–100).
 *  0% complaints = 100, 0.5%+ complaints = 0. Linear between. */
export function calculateComplaintScore(complaintRate: number): number {
  if (complaintRate < 0) complaintRate = 0;
  const score = 100 - complaintRate * 2000; // 0.5% → 0
  return Math.round(Math.max(0, Math.min(100, score)));
}

// ── Overall score ──

/** Calculate overall deliverability score (0–100) */
export function calculateOverallScore(
  dnsScore: number,
  bounceScore: number,
  complaintScore: number,
): number {
  return Math.round(dnsScore * 0.4 + bounceScore * 0.3 + complaintScore * 0.3);
}

// ── Recommendations ──

/** Score tier for display */
export function scoreTier(score: number): 'good' | 'warning' | 'bad' {
  if (score >= 80) return 'good';
  if (score >= 50) return 'warning';
  return 'bad';
}

/** Generate prioritized, actionable recommendations */
export function generateRecommendations(
  report: DnsHealthReport,
  bounceRate: number,
  complaintRate: number,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // DNS recommendations
  for (const check of [report.spf, report.dkim, report.dmarc, report.mx]) {
    if (check.status === 'fail') {
      recs.push({
        priority: 1,
        category: 'dns',
        title: `Fix ${check.label} record`,
        description: check.message,
      });
    } else if (check.status === 'warning') {
      recs.push({
        priority: 2,
        category: 'dns',
        title: `Improve ${check.label} record`,
        description: check.message,
      });
    }
  }

  // Bounce rate recommendations
  if (bounceRate >= 0.05) {
    recs.push({
      priority: 1,
      category: 'bounces',
      title: 'High bounce rate detected',
      description: `Your bounce rate is ${(bounceRate * 100).toFixed(1)}% — well above the 2% industry threshold. Enable auto-clean in Settings to automatically suppress bounced addresses, and verify your list uses confirmed opt-in.`,
    });
  } else if (bounceRate >= 0.02) {
    recs.push({
      priority: 2,
      category: 'bounces',
      title: 'Bounce rate above recommended threshold',
      description: `Your bounce rate is ${(bounceRate * 100).toFixed(1)}%. Industry best practice is under 2%. Review your list hygiene and consider enabling auto-clean in Settings.`,
    });
  }

  // Complaint rate recommendations
  if (complaintRate >= 0.003) {
    recs.push({
      priority: 1,
      category: 'complaints',
      title: 'Spam complaint rate critical',
      description: `Your complaint rate is ${(complaintRate * 100).toFixed(2)}% — Google and Yahoo require rates below 0.3% (effective Feb 2024). Immediately review your opt-in process and remove unengaged subscribers.`,
    });
  } else if (complaintRate >= 0.001) {
    recs.push({
      priority: 2,
      category: 'complaints',
      title: 'Monitor complaint rate',
      description: `Your complaint rate is ${(complaintRate * 100).toFixed(2)}%. Keep it below 0.1% for best deliverability. Ensure your unsubscribe link is prominent and your content matches what subscribers signed up for.`,
    });
  }

  // If everything is good, add a positive recommendation
  if (recs.length === 0) {
    recs.push({
      priority: 3,
      category: 'general',
      title: 'Deliverability looks great',
      description: 'All DNS records are properly configured and your bounce/complaint rates are healthy. Keep monitoring this dashboard and maintain good list hygiene.',
    });
  }

  // Sort by priority
  recs.sort((a, b) => a.priority - b.priority);

  return recs;
}
