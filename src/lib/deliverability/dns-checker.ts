/**
 * DNS record checker for deliverability health.
 *
 * Uses Node.js built-in `dns.promises` — zero dependencies.
 * Checks SPF, DKIM, DMARC, and MX records for a given domain,
 * validating them against the configured email provider's requirements.
 */

import { Resolver } from 'dns/promises';
import type { MxRecord } from 'dns';
import type { DnsCheckResult, DnsHealthReport, DnsStatus } from './types';

// ── Provider-specific DKIM selectors ──

const DKIM_SELECTORS: Record<string, string[]> = {
  sendgrid: ['s1._domainkey', 's2._domainkey'],
  resend: ['resend._domainkey'],
  ses: [], // SES uses custom selectors set by the user
};

const SPF_EXPECTED: Record<string, string> = {
  sendgrid: 'include:sendgrid.net',
  resend: 'include:spf.resend.com',
  ses: 'include:amazonses.com',
};

function resolveDkimSelectors(provider: string): string[] {
  const normalized = (provider || '').toLowerCase();
  return DKIM_SELECTORS[normalized] || DKIM_SELECTORS.sendgrid;
}

function resolveSpfExpected(provider: string): string {
  const normalized = (provider || '').toLowerCase();
  return SPF_EXPECTED[normalized] || SPF_EXPECTED.sendgrid;
}

// ── Helpers ──

function result(
  status: DnsStatus,
  label: string,
  value: string | null,
  expected: string | null,
  message: string,
): DnsCheckResult {
  return { status, label, value, expected, message };
}

/**
 * A resolver with a real query timeout.
 *
 * `dns.resolveTxt`/`resolveMx` take only a hostname — they accept no options
 * object and no AbortSignal, so the previous `{ signal }` argument was both a
 * type error and a no-op. `new Resolver({ timeout, tries })` is the supported
 * mechanism; timeout is per attempt, in milliseconds.
 */
function timeboxedResolver(timeoutMs: number): Resolver {
  return new Resolver({ timeout: timeoutMs, tries: 2 });
}

async function resolveTxtSafe(domain: string, timeoutMs = 5000): Promise<string[][]> {
  try {
    return await timeboxedResolver(timeoutMs).resolveTxt(domain);
  } catch {
    return [];
  }
}

async function resolveMxSafe(domain: string, timeoutMs = 5000): Promise<MxRecord[]> {
  try {
    return await timeboxedResolver(timeoutMs).resolveMx(domain);
  } catch {
    return [];
  }
}

// ── Individual checks ──

/** Check SPF TXT record on the root domain */
export async function checkSpf(domain: string, provider: string): Promise<DnsCheckResult> {
  const expectedInclude = resolveSpfExpected(provider);
  const records = await resolveTxtSafe(domain);
  const spfRecords = records
    .map(r => r.join(''))
    .filter(r => r.startsWith('v=spf1'));

  if (spfRecords.length === 0) {
    return result(
      'fail',
      'SPF',
      null,
      `v=spf1 ... ${expectedInclude} ... -all`,
      `No SPF record found for ${domain}. Add a TXT record with: v=spf1 ${expectedInclude} ~all`,
    );
  }

  if (spfRecords.length > 1) {
    return result(
      'warning',
      'SPF',
      spfRecords[0],
      `v=spf1 ... ${expectedInclude} ... -all`,
      `Multiple SPF records found (${spfRecords.length}). Only one should exist. Current: ${spfRecords[0]}`,
    );
  }

  const record = spfRecords[0];

  if (record.includes(expectedInclude)) {
    return result(
      'pass',
      'SPF',
      record,
      `includes ${expectedInclude}`,
      `SPF record is correctly configured with ${expectedInclude}.`,
    );
  }

  return result(
    'warning',
    'SPF',
    record,
    `v=spf1 ... ${expectedInclude} ... ~all`,
    `SPF record exists but is missing ${expectedInclude}. Current: ${record}`,
  );
}

/** Check DKIM TXT/CNAME records using provider-specific selectors */
export async function checkDkim(domain: string, provider: string): Promise<DnsCheckResult> {
  const selectors = resolveDkimSelectors(provider);

  if (selectors.length === 0) {
    return result(
      'unknown',
      'DKIM',
      null,
      null,
      `Provider "${provider}" uses custom DKIM selectors. Configure your DKIM selector in settings and verify manually.`,
    );
  }

  const results: { selector: string; found: boolean; value?: string }[] = [];

  for (const selector of selectors) {
    const fqdn = `${selector}.${domain}`;
    const records = await resolveTxtSafe(fqdn);
    if (records.length > 0) {
      results.push({ selector, found: true, value: records[0].join('') });
    } else {
      results.push({ selector, found: false });
    }
  }

  const found = results.filter(r => r.found);

  if (found.length === 0) {
    const examples = selectors.map(s => `${s}.${domain}`).join(' or ');
    return result(
      'fail',
      `DKIM (${selectors[0]})`,
      null,
      `CNAME records at ${examples}`,
      `No DKIM records found. Add the CNAME records provided by ${provider} at ${examples}.`,
    );
  }

  const allFound = found.length === selectors.length;
  const value = found.map(r => `${r.selector}: ${r.value}`).join('; ');

  return result(
    allFound ? 'pass' : 'warning',
    `DKIM (${selectors.join(', ')})`,
    value,
    `DKIM records for all selectors`,
    allFound
      ? `All ${selectors.length} DKIM record(s) verified.`
      : `${found.length}/${selectors.length} DKIM records found. Missing: ${results.filter(r => !r.found).map(r => r.selector).join(', ')}`,
  );
}

/** Check DMARC TXT record at _dmarc.{domain} */
export async function checkDmarc(domain: string): Promise<DnsCheckResult> {
  const dmarcDomain = `_dmarc.${domain}`;
  const records = await resolveTxtSafe(dmarcDomain);
  const dmarcRecords = records
    .map(r => r.join(''))
    .filter(r => r.startsWith('v=DMARC1'));

  if (dmarcRecords.length === 0) {
    return result(
      'warning',
      'DMARC',
      null,
      'v=DMARC1; p=none; rua=mailto:...',
      `No DMARC record found at ${dmarcDomain}. Add a TXT record: v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    );
  }

  const record = dmarcRecords[0];
  const hasReject = record.includes('p=reject');
  const hasQuarantine = record.includes('p=quarantine');
  const hasRua = record.includes('rua=');

  if (hasReject) {
    return result(
      'pass',
      'DMARC',
      record,
      'p=reject or p=quarantine',
      `DMARC policy is set to "reject" — strongest protection.${hasRua ? ' Aggregate reports enabled.' : ''}`,
    );
  }

  if (hasQuarantine) {
    return result(
      'pass',
      'DMARC',
      record,
      'p=reject or p=quarantine',
      `DMARC policy is set to "quarantine". Consider upgrading to "p=reject" for maximum protection.${hasRua ? ' Aggregate reports enabled.' : ''}`,
    );
  }

  // p=none — monitoring only, no protection
  return result(
    'warning',
    'DMARC',
    record,
    'p=quarantine or p=reject',
    `DMARC is set to "p=none" (monitoring only). Emails will still be delivered even if they fail DMARC. Upgrade to "p=quarantine" or "p=reject".`,
  );
}

/** Check MX records exist for the domain */
export async function checkMx(domain: string): Promise<DnsCheckResult> {
  const records = await resolveMxSafe(domain);

  if (records.length === 0) {
    return result(
      'fail',
      'MX',
      null,
      'MX record(s) pointing to a mail server',
      `No MX records found for ${domain}. Your domain needs MX records to receive email (bounce notifications, replies).`,
    );
  }

  const sorted = records.sort((a, b) => a.priority - b.priority);
  const value = sorted.map(r => `${r.exchange} (priority ${r.priority})`).join(', ');

  return result(
    'pass',
    'MX',
    value,
    'MX record(s)',
    `${records.length} MX record(s) found. Your domain can receive email.`,
  );
}

// ── Aggregate check ──

/** Check all DNS records for a domain and provider. Returns a full DnsHealthReport. */
export async function checkAllDns(domain: string, provider: string): Promise<DnsHealthReport> {
  const [spf, dkim, dmarc, mx] = await Promise.all([
    checkSpf(domain, provider),
    checkDkim(domain, provider),
    checkDmarc(domain),
    checkMx(domain),
  ]);

  return {
    domain,
    checkedAt: new Date().toISOString(),
    spf,
    dkim,
    dmarc,
    mx,
  };
}
