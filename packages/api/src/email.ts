/**
 * Cullit Email Service
 *
 * Transactional email via Resend API (https://resend.com).
 * Zero-dependency — uses native fetch.
 *
 * Environment Variables:
 *   RESEND_API_KEY  — Resend API key (re_...)
 *   EMAIL_FROM      — Sender address (default: Cullit <noreply@cullit.io>)
 */

const RESEND_API_KEY = process.env['RESEND_API_KEY'] || '';
const EMAIL_FROM = process.env['EMAIL_FROM'] || 'Cullit <noreply@cullit.io>';

import { log } from './logger.js';
import { escapeHtml } from '@cullit/core';
import { dbCountRecentEmails, dbRecordEmailSent, sql } from './db.js';

// --- Per-recipient email throttle (max 10 emails per hour) ---
// Primary: DB-backed (survives restarts, works across replicas).
// Fallback: in-memory map when DATABASE_URL is not configured.
const EMAIL_THROTTLE_MAX = 10;
const EMAIL_THROTTLE_WINDOW = 60 * 60 * 1000; // 1 hour
const EMAIL_MAP_MAX_KEYS = 10_000; // bound memory: evict stale entries beyond this
const emailSentTimestamps = new Map<string, number[]>();

function evictStaleEntries(): void {
  if (emailSentTimestamps.size <= EMAIL_MAP_MAX_KEYS) return;
  const now = Date.now();
  for (const [key, timestamps] of emailSentTimestamps) {
    const recent = timestamps.filter(t => now - t < EMAIL_THROTTLE_WINDOW);
    if (recent.length === 0) {
      emailSentTimestamps.delete(key);
    } else {
      emailSentTimestamps.set(key, recent);
    }
  }
  // If still over limit, drop oldest entries
  while (emailSentTimestamps.size > EMAIL_MAP_MAX_KEYS) {
    const first = emailSentTimestamps.keys().next().value;
    if (first !== undefined) emailSentTimestamps.delete(first); else break;
  }
}

async function isEmailThrottled(to: string): Promise<boolean> {
  if (sql) {
    try {
      const count = await dbCountRecentEmails(to, EMAIL_THROTTLE_WINDOW);
      return count >= EMAIL_THROTTLE_MAX;
    } catch (err) {
      log.warn({ err: (err as Error).message, to }, 'DB email throttle check failed; falling back to in-memory');
      // fall through to in-memory check
    }
  }
  const now = Date.now();
  const timestamps = emailSentTimestamps.get(to) || [];
  const recent = timestamps.filter(t => now - t < EMAIL_THROTTLE_WINDOW);
  emailSentTimestamps.set(to, recent);
  return recent.length >= EMAIL_THROTTLE_MAX;
}

async function recordEmailSent(to: string): Promise<void> {
  if (sql) {
    try {
      await dbRecordEmailSent(to);
      return;
    } catch (err) {
      log.warn({ err: (err as Error).message, to }, 'DB email throttle write failed; using in-memory fallback');
      // fall through
    }
  }
  const timestamps = emailSentTimestamps.get(to) || [];
  timestamps.push(Date.now());
  emailSentTimestamps.set(to, timestamps);
  evictStaleEntries();
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function send(options: EmailOptions): Promise<boolean> {
  const result = await sendWithReason(options);
  return result.sent;
}

async function sendWithReason(options: EmailOptions): Promise<{ sent: boolean; reason?: string }> {
  if (!RESEND_API_KEY) {
    log.warn({ subject: options.subject, to: options.to }, 'Email skipped (RESEND_API_KEY not set)');
    return { sent: false, reason: 'not_configured' };
  }

  if (await isEmailThrottled(options.to)) {
    log.warn({ to: options.to, subject: options.subject }, 'Email throttled (rate limit exceeded)');
    return { sent: false, reason: 'throttled' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.error({ status: res.status, err, to: options.to }, 'Email send failed');
      return { sent: false, reason: 'api_error' };
    }
    recordEmailSent(options.to).catch(() => { /* best-effort — throttle records are non-critical */ });
    return { sent: true };
  } catch (err) {
    log.error({ err: (err as Error).message, to: options.to }, 'Email send error');
    return { sent: false, reason: 'network_error' };
  }
}

// --- Email templates ---

const BRAND = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <div style="margin-bottom: 24px;">
    <span style="font-size: 20px; font-weight: 700; color: #0f1117;">cullit</span><span style="color: #5eead4; font-weight: 700;">.io</span>
  </div>
`;

const FOOTER = `
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
  <p style="font-size: 12px; color: #9ca3af;">
    Cullit — AI-powered release notes.<br>
    <a href="https://cullit.io" style="color: #5eead4;">cullit.io</a> &middot;
    <a href="https://cullit.io/terms.html" style="color: #5eead4;">Terms</a> &middot;
    <a href="https://cullit.io/privacy.html" style="color: #5eead4;">Privacy</a>
  </p>
</div>
`;

export async function sendWelcome(email: string, name: string): Promise<boolean> {
  return send({
    to: email,
    subject: 'Welcome to Cullit!',
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Welcome, ${escapeHtml(name)}!</h2>
      <p style="color: #374151; line-height: 1.6;">
        Your account is ready. You can view your API key for CLI, GitHub Action, and API access in your dashboard:
      </p>
      <p style="margin: 16px 0;">
        <a href="https://cullit.io/dashboard.html" style="background: #5eead4; color: #0f1117; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Go to Dashboard
        </a>
      </p>
      <p style="color: #374151; line-height: 1.6; margin-top: 16px;">
        Get started:
      </p>
      <pre style="background: #1f2937; color: #d1d5db; padding: 16px; border-radius: 8px; font-size: 13px; overflow-x: auto;">npm install -g cullit
export CULLIT_API_KEY="your-key-from-dashboard"
cullit generate --from v1.0.0</pre>
      <p style="color: #374151; line-height: 1.6; margin-top: 16px;">
        <a href="https://cullit.io/docs.html" style="color: #5eead4;">Read the docs</a> &middot;
        <a href="https://cullit.io/tutorial.html" style="color: #5eead4;">Interactive tutorial</a>
      </p>
    ${FOOTER}`,
  });
}

const PLAN_DETAILS: Record<string, { label: string; features: string[] }> = {
  pro: {
    label: 'Pro ($9/mo)',
    features: [
      '500 generations/month',
      '100 projects',
      'AI generation (OpenAI, Anthropic, Gemini, Ollama)',
      'Jira & Linear enrichment',
      'All publishers (Slack, Discord, GitHub, Teams)',
    ],
  },
  team: {
    label: 'Team ($9/seat/mo)',
    features: [
      'Dynamic seats (1+ seats)',
      'All Pro features',
      'Team management dashboard',
      'GitLab & Bitbucket',
      'Priority support',
    ],
  },
};

export async function sendSubscriptionConfirmed(email: string, name: string, plan: string, apiKey?: string): Promise<boolean> {
  const details = PLAN_DETAILS[plan] || PLAN_DETAILS.pro;
  const displayName = plan.startsWith('team') ? 'Team' : plan.charAt(0).toUpperCase() + plan.slice(1);
  const apiKeySection = apiKey ? `
      <div style="background: #1a1a2e; border: 1px solid #2d2d44; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="color: #5eead4; font-weight: 600; margin: 0 0 8px 0;">Your API Key</p>
        <code style="color: #f0f0f0; font-family: monospace; font-size: 14px; word-break: break-all;">${escapeHtml(apiKey)}</code>
        <p style="color: #6b7280; font-size: 12px; margin: 8px 0 0 0;">
          Save this key — it won't be shown again. You can rotate it anytime from the
          <a href="https://cullit.io/dashboard.html" style="color: #5eead4;">dashboard Settings tab</a>.
        </p>
      </div>` : '';
  return send({
    to: email,
    subject: `You're on Cullit ${displayName}!`,
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Subscription confirmed</h2>
      <p style="color: #374151; line-height: 1.6;">
        Hi ${escapeHtml(name)}, your <strong>${details.label}</strong> subscription is now active.
      </p>${apiKeySection}
      <p style="color: #374151; line-height: 1.6;">
        You now have access to:
      </p>
      <ul style="color: #374151; line-height: 1.8; padding-left: 20px;">
        ${details.features.map(f => `<li>${f}</li>`).join('\n        ')}
      </ul>
      <p style="color: #374151; line-height: 1.6;">
        View your API key and manage your subscription from the
        <a href="https://cullit.io/dashboard.html" style="color: #5eead4;">dashboard</a>.
      </p>
    ${FOOTER}`,
  });
}

export async function sendPaymentFailed(email: string, name: string): Promise<boolean> {
  return send({
    to: email,
    subject: 'Cullit — Payment failed',
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Payment issue</h2>
      <p style="color: #374151; line-height: 1.6;">
        Hi ${escapeHtml(name)}, we couldn't process your latest payment.
      </p>
      <p style="color: #374151; line-height: 1.6;">
        Please update your payment method to keep your subscription active:
      </p>
      <p style="margin: 16px 0;">
        <a href="https://cullit.io/dashboard.html" style="background: #5eead4; color: #0f1117; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Update Payment Method
        </a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">
        If you need help, reply to this email or contact <a href="mailto:sales@cullit.io" style="color: #5eead4;">sales@cullit.io</a>.
      </p>
    ${FOOTER}`,
  });
}

export async function sendOrgInvite(email: string, orgName: string, inviterName: string, role: string, token: string): Promise<boolean> {
  const acceptUrl = `https://cullit.io/dashboard.html?invite=${encodeURIComponent(token)}`;
  return send({
    to: email,
    subject: `You're invited to join ${orgName} on Cullit`,
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">You've been invited</h2>
      <p style="color: #374151; line-height: 1.6;">
        ${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(orgName)}</strong> as a <strong>${escapeHtml(role)}</strong> on Cullit.
      </p>
      <p style="margin: 20px 0;">
        <a href="${acceptUrl}" style="background: #5eead4; color: #0f1117; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Accept Invitation
        </a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">
        This invitation expires in 7 days. If you don't have a Cullit account, you'll be prompted to create one.
      </p>
    ${FOOTER}`,
  });
}

export async function sendTeamApiKey(email: string, recipientName: string, orgName: string, senderName: string, label: string): Promise<{ sent: boolean; reason?: string }> {
  return sendWithReason({
    to: email,
    subject: `Your Cullit API key for ${orgName}`,
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Your team API key</h2>
      <p style="color: #374151; line-height: 1.6;">
        Hi ${escapeHtml(recipientName)}, ${escapeHtml(senderName)} has assigned you an API key for <strong>${escapeHtml(orgName)}</strong>${label ? ` (${escapeHtml(label)})` : ''}.
      </p>
      <p style="color: #374151; line-height: 1.6;">
        View your API key in the dashboard:
      </p>
      <p style="margin: 16px 0;">
        <a href="https://cullit.io/dashboard.html" style="background: #5eead4; color: #0f1117; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Go to Dashboard
        </a>
      </p>
      <pre style="background: #1f2937; color: #d1d5db; padding: 16px; border-radius: 8px; font-size: 13px; overflow-x: auto;">export CULLIT_API_KEY="your-key-from-dashboard"
cullit generate --from v1.0.0</pre>
      <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
        <strong>Keep your key safe.</strong> If you believe it has been compromised, ask your team admin to rotate it.
      </p>
    ${FOOTER}`,
  });
}

export async function sendUsageAlert(email: string, name: string, used: number, limit: number): Promise<boolean> {
  const pct = Math.round((used / limit) * 100);
  return send({
    to: email,
    subject: `Cullit — ${pct}% of monthly generations used`,
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Usage alert</h2>
      <p style="color: #374151; line-height: 1.6;">
        Hi ${escapeHtml(name)}, you've used <strong>${used} of ${limit}</strong> generations this month (${pct}%).
      </p>
      <p style="color: #374151; line-height: 1.6;">
        <a href="https://cullit.io/pricing.html" style="color: #5eead4;">Upgrade your plan</a> for more generations.
      </p>
    ${FOOTER}`,
  });
}

export async function sendProvisioningFailed(email: string, name: string, plan: string, seats: number): Promise<boolean> {
  return send({
    to: email,
    subject: 'Cullit — Subscription canceled (team key provisioning failed)',
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">We couldn't set up your team keys</h2>
      <p style="color: #374151; line-height: 1.6;">
        Hi ${escapeHtml(name)}, your <strong>${escapeHtml(plan)}</strong> subscription (${seats} seats) was canceled
        because we couldn't provision your team API keys after several attempts.
      </p>
      <p style="color: #374151; line-height: 1.6;">
        Your card has been refunded automatically by Stripe. You can try again from the
        <a href="https://cullit.io/pricing.html" style="color: #5eead4;">pricing page</a>,
        or reply to this email if you'd like help diagnosing the issue.
      </p>
      <p style="color: #6b7280; font-size: 13px;">
        We're sorry for the inconvenience.
      </p>
    ${FOOTER}`,
  });
}

export function isEmailConfigured(): boolean {
  return !!RESEND_API_KEY;
}

// Exported for testing
export { isEmailThrottled as _isEmailThrottled, recordEmailSent as _recordEmailSent };
export const _EMAIL_THROTTLE_MAX = EMAIL_THROTTLE_MAX;
export function _resetThrottleState(): void { emailSentTimestamps.clear(); }
