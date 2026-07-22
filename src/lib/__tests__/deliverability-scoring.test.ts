import { describe, it, expect } from 'vitest';
import {
  calculateDnsScore,
  calculateBounceScore,
  calculateComplaintScore,
  calculateOverallScore,
  generateRecommendations,
} from '../deliverability/scoring';
import type { DnsHealthReport } from '../deliverability/types';

// ── Test helpers ──

function makeReport(overrides?: Partial<DnsHealthReport>): DnsHealthReport {
  return {
    domain: 'example.com',
    checkedAt: new Date().toISOString(),
    spf: { status: 'pass', label: 'SPF', value: 'v=spf1 include:sendgrid.net ~all', expected: 'include:sendgrid.net', message: 'OK' },
    dkim: { status: 'pass', label: 'DKIM', value: 'k=rsa; p=...', expected: 'DKIM record', message: 'OK' },
    dmarc: { status: 'pass', label: 'DMARC', value: 'v=DMARC1; p=reject', expected: 'p=reject', message: 'OK' },
    mx: { status: 'pass', label: 'MX', value: 'mail.example.com (10)', expected: 'MX record', message: 'OK' },
    ...overrides,
  };
}

// ── calculateDnsScore ──

describe('calculateDnsScore', () => {
  it('returns 100 when all four records pass', () => {
    expect(calculateDnsScore(makeReport())).toBe(100);
  });

  it('returns 88 when one record is warning (50) and three pass (100)', () => {
    const report = makeReport({
      spf: { status: 'warning', label: 'SPF', value: null, expected: 'include:sendgrid.net', message: 'Missing include' },
    });
    // (50 + 100 + 100 + 100) / 4 = 87.5 → 88
    expect(calculateDnsScore(report)).toBe(88);
  });

  it('returns 50 when two records fail and two pass', () => {
    const report = makeReport({
      spf: { status: 'fail', label: 'SPF', value: null, expected: 'include:sendgrid.net', message: 'Missing' },
      dkim: { status: 'fail', label: 'DKIM', value: null, expected: 'record', message: 'Missing' },
    });
    // (0 + 0 + 100 + 100) / 4 = 50
    expect(calculateDnsScore(report)).toBe(50);
  });

  it('returns 0 when all four records fail', () => {
    const fail = { status: 'fail' as const, label: 'X', value: null, expected: null, message: 'Missing' };
    const report = makeReport({ spf: fail, dkim: fail, dmarc: fail, mx: fail });
    expect(calculateDnsScore(report)).toBe(0);
  });

  it('treats unknown status as 50 (neutral)', () => {
    const unknown = { status: 'unknown' as const, label: 'X', value: null, expected: null, message: '?' };
    const report = makeReport({ spf: unknown, dkim: unknown, dmarc: unknown, mx: unknown });
    expect(calculateDnsScore(report)).toBe(50);
  });
});

// ── calculateBounceScore ──

describe('calculateBounceScore', () => {
  it('returns 100 for 0% bounce rate', () => {
    expect(calculateBounceScore(0)).toBe(100);
  });

  it('returns 80 for 2% bounce rate', () => {
    expect(calculateBounceScore(0.02)).toBe(80);
  });

  it('returns 50 for 5% bounce rate', () => {
    expect(calculateBounceScore(0.05)).toBe(50);
  });

  it('returns 0 at 10% bounce rate (boundary)', () => {
    expect(calculateBounceScore(0.1)).toBe(0);
  });

  it('returns 0 for rates above 10% (clamped)', () => {
    expect(calculateBounceScore(0.5)).toBe(0);
  });

  it('clamps negative rates to 100', () => {
    expect(calculateBounceScore(-0.01)).toBe(100);
  });
});

// ── calculateComplaintScore ──

describe('calculateComplaintScore', () => {
  it('returns 100 for 0% complaint rate', () => {
    expect(calculateComplaintScore(0)).toBe(100);
  });

  it('returns 98 for 0.1% complaint rate', () => {
    // 100 - 0.001 * 2000 = 98
    expect(calculateComplaintScore(0.001)).toBe(98);
  });

  it('returns 90 for 0.5% complaint rate', () => {
    // 100 - 0.005 * 2000 = 90
    expect(calculateComplaintScore(0.005)).toBe(90);
  });

  it('returns 0 at 5% complaint rate (scale boundary)', () => {
    // 100 - 0.05 * 2000 = 0
    expect(calculateComplaintScore(0.05)).toBe(0);
  });

  it('clamps negative rates to 100', () => {
    expect(calculateComplaintScore(-0.001)).toBe(100);
  });
});

// ── calculateOverallScore ──

describe('calculateOverallScore', () => {
  it('returns 100 when all subscores are 100', () => {
    expect(calculateOverallScore(100, 100, 100)).toBe(100);
  });

  it('returns 50 when all subscores are 50', () => {
    expect(calculateOverallScore(50, 50, 50)).toBe(50);
  });

  it('weights DNS at 40%, bounce at 30%, complaint at 30%', () => {
    // DNS=100 → 40, bounce=0 → 0, complaint=0 → 0
    expect(calculateOverallScore(100, 0, 0)).toBe(40);
    expect(calculateOverallScore(0, 100, 0)).toBe(30);
    expect(calculateOverallScore(0, 0, 100)).toBe(30);
  });

  it('rounds to nearest integer', () => {
    // 50*0.4 + 33*0.3 + 33*0.3 = 20 + 9.9 + 9.9 = 39.8 → 40
    expect(calculateOverallScore(50, 33, 33)).toBe(40);
  });
});

// ── generateRecommendations ──

describe('generateRecommendations', () => {
  it('returns "looks great" when all DNS pass and rates are healthy', () => {
    const recs = generateRecommendations(makeReport(), 0.01, 0.0005);
    expect(recs).toHaveLength(1);
    expect(recs[0].category).toBe('general');
    expect(recs[0].title).toContain('great');
  });

  it('flags failing DNS as priority 1', () => {
    const report = makeReport({
      spf: { status: 'fail', label: 'SPF', value: null, expected: 'include:sendgrid.net', message: 'No SPF record' },
    });
    const recs = generateRecommendations(report, 0, 0);
    expect(recs.some(r => r.priority === 1 && r.category === 'dns')).toBe(true);
  });

  it('flags warning DNS as priority 2', () => {
    const report = makeReport({
      dmarc: { status: 'warning', label: 'DMARC', value: 'v=DMARC1; p=none', expected: 'p=reject', message: 'Set to reject' },
    });
    const recs = generateRecommendations(report, 0, 0);
    expect(recs.some(r => r.priority === 2 && r.category === 'dns')).toBe(true);
  });

  it('flags high bounce rate (5%+) as priority 1', () => {
    const recs = generateRecommendations(makeReport(), 0.08, 0);
    expect(recs.some(r => r.category === 'bounces' && r.priority === 1)).toBe(true);
  });

  it('flags moderate bounce rate (2%+) as priority 2', () => {
    const recs = generateRecommendations(makeReport(), 0.03, 0);
    expect(recs.some(r => r.category === 'bounces' && r.priority === 2)).toBe(true);
  });

  it('flags high complaint rate (0.3%+) as priority 1', () => {
    const recs = generateRecommendations(makeReport(), 0, 0.004);
    expect(recs.some(r => r.category === 'complaints' && r.priority === 1)).toBe(true);
  });

  it('flags moderate complaint rate (0.1%+) as priority 2', () => {
    const recs = generateRecommendations(makeReport(), 0, 0.002);
    expect(recs.some(r => r.category === 'complaints' && r.priority === 2)).toBe(true);
  });

  it('returns multiple recommendations sorted by priority', () => {
    const report = makeReport({
      spf: { status: 'fail', label: 'SPF', value: null, expected: '...', message: 'No SPF' },
      dmarc: { status: 'warning', label: 'DMARC', value: 'v=DMARC1; p=none', expected: 'p=reject', message: 'Upgrade' },
    });
    const recs = generateRecommendations(report, 0.06, 0.001);
    // Priority 1: fail SPF + high bounce → at least 2
    const priority1s = recs.filter(r => r.priority === 1);
    expect(priority1s.length).toBeGreaterThanOrEqual(2);
    // Verify sorted
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].priority).toBeGreaterThanOrEqual(recs[i - 1].priority);
    }
  });

  it('handles zero sends without crashing', () => {
    const recs = generateRecommendations(makeReport(), 0, 0);
    // Should still return DNS status (all pass) + general "looks great"
    expect(recs.length).toBeGreaterThan(0);
  });
});
