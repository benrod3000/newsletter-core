// Curated list of common disposable email domains
// Prevents signups with temporary email addresses
const DISPOSABLE_DOMAINS: string[] = [
  "0-mail.com", "0815.ru", "10minutemail.com", "anonym-mail.net",
  "anonymousspeech.com", "binkmail.com", "bobmail.info", "brefmail.com",
  "bsnow.net", "chacuo.net", "cleantalk.org", "cock.li", "cool.fr.nf",
  "correo.blogos.net", "courriel.fr.nf", "crapmail.org", "curryworld.de",
  "dethware.net", "disposable-email.ml", "disposable.cf", "disposable.ga",
  "disposable.ml", "email-fake.com", "email-generator.org", "emailgo.de",
  "emailias.com", "emaill.me", "emailnator.com", "emails.ga",
  "emailservice.io", "emailtemps.com", "emailtex.com", "ephemail.net",
  "eyepaste.com", "fakemailgenerator.com", "fakemail.net", "fammix.com",
  "filzmail.com", "frapmail.com", "garbage.com", "garbagemail.org",
  "generator.email", "getairmail.com", "getnada.com", "ghostmailer.com",
  "goemailgo.com", "guerrillamail.com", "guerrillamail.net",
  "guerrillamail.org", "h8s.org", "haltospam.com", "hidemail.pro",
  "incognitomail.com", "inoutmail.de", "intempmail.com",
  "internetoftags.com", "ip6.li", "jetable.org", "jourrapide.com",
  "just-email.net", "kwift.net", "lags.us", "lastmail.com",
  "letterboxes.org", "lopl.co.cc", "mail-c.tk", "mail-temporaire.fr",
  "mail.by", "mail.usa.com", "mailcatch.com", "maildrop.cc", "maildu.de",
  "maileater.com", "mailexpire.com", "mailfa.tk", "mailforspam.com",
  "mailguard.me", "mailimate.com", "mailin8r.com", "mailincubator.com",
  "mailinator.com", "mailinator.org", "mailinator.us", "mailismagic.com",
  "mailme.ir", "mailmetrash.com", "mailnator.com", "mailnull.com",
  "mailpick.biz", "mailprotech.com", "mailsac.com", "mailtemp.net",
  "mailsy.com", "mailzilla.com", "moburl.com", "msgos.com",
  "mytrashmail.com", "nevermail.de", "nobulk.com", "nopmail.com",
  "nowmymail.com", "o2stk.org", "odnorazovoe.ru", "one-time.email",
  "oneoffemail.com", "oneoffmail.com", "opayq.com", "ourinbox.com",
  "outlawspam.com", "owlymail.com", "pookmail.com", "privacy-mail.net",
  "privy-mail.com", "proxymail.eu", "putthisinyourspamdatabase.com",
  "quickinbox.com", "rcpt.at", "receiveee.com", "recode.me",
  "regbypass.com", "rtrtr.com", "safe-mail.net",
  "senseless-entertainment.com", "sharklasers.com", "shhmail.com",
  "slippery.email", "slopsbox.com", "smellfear.com", "snapbox.ml",
  "sofort-mail.de", "sofortmail.de", "spam.cf", "spam.ga", "spam.gq",
  "spam.mk", "spam4.me", "spambox.us", "spamcero.com", "spamdecoy.net",
  "spameater.org", "spamfree24.org", "spamgoes.in",
  "spamhereplease.com", "spamhole.com", "spamify.com", "spaminator.de",
  "spamkill.info", "spamlot.net", "spamobox.com", "spamslicer.com",
  "spamsphere.com", "spamstack.net", "spamthis.co.uk", "spamtrail.com",
  "spamtroll.net", "spamavert.com", "spoofmail.de",
  "stopdropandroll.com", "stuff-about-money.com", "suioe.com",
  "temporaryemail.us", "temporarymail.org", "temprem.com",
  "tempemail.co", "tempemail.com", "tempinbox.com", "tempmail.ws",
  "tempomail.fr", "thc.st", "thisisnotmyrealemail.com",
  "throwaway.email", "throwaway.ml", "trash2009.com", "trashmail.com",
  "trashmail.me", "trashmail.net", "trashymail.com", "turual.com",
  "twinmail.de", "tyldd.com", "uggsrock.com", "umail.net",
  "upliftnow.com", "venompen.com", "veryrealemail.com", "viditag.com",
  "viewcastmedia.com", "webm4il.in", "wegwerfmail.de", "wegwerfmail.net",
  "wegwerfmail.org", "wh4f.org", "whyspam.me", "willselfdestruct.com",
  "winemaven.info", "wronghead.com", "wuzup.net", "xagloo.com",
  "xemaps.com", "xents.com", "yep.it", "yopmail.com", "yopmail.fr",
  "yopmail.net", "yopmail.org", "yuurok.com", "zehnminutenemail.de",
  "zippymail.info", "zoaxe.com", "zoemail.org",
];

const DOMAIN_SET = new Set(DISPOSABLE_DOMAINS);

/**
 * Check if an email address uses a disposable email provider
 */
export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@").pop()?.toLowerCase().trim();
  if (!domain) return false;
  return DOMAIN_SET.has(domain);
}
