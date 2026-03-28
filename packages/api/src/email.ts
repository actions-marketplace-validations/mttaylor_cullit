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

// --- Per-recipient email throttle (max 10 emails per hour) ---
const EMAIL_THROTTLE_MAX = 10;
const EMAIL_THROTTLE_WINDOW = 60 * 60 * 1000; // 1 hour
const emailSentTimestamps = new Map<string, number[]>();

function isEmailThrottled(to: string): boolean {
  const now = Date.now();
  const timestamps = emailSentTimestamps.get(to) || [];
  const recent = timestamps.filter(t => now - t < EMAIL_THROTTLE_WINDOW);
  emailSentTimestamps.set(to, recent);
  return recent.length >= EMAIL_THROTTLE_MAX;
}

function recordEmailSent(to: string): void {
  const timestamps = emailSentTimestamps.get(to) || [];
  timestamps.push(Date.now());
  emailSentTimestamps.set(to, timestamps);
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function send(options: EmailOptions): Promise<boolean> {
  if (!RESEND_API_KEY) {
    log.warn({ subject: options.subject, to: options.to }, 'Email skipped (RESEND_API_KEY not set)');
    return false;
  }

  if (isEmailThrottled(options.to)) {
    log.warn({ to: options.to, subject: options.subject }, 'Email throttled (rate limit exceeded)');
    return false;
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
      log.error({ status: res.status, err }, 'Email send failed');
      return false;
    }
    recordEmailSent(options.to);
    return true;
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Email send error');
    return false;
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

export async function sendWelcome(email: string, name: string, apiKey: string): Promise<boolean> {
  return send({
    to: email,
    subject: 'Welcome to Cullit!',
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Welcome, ${escapeHtml(name)}!</h2>
      <p style="color: #374151; line-height: 1.6;">
        Your account is ready. Here's your API key for CLI, GitHub Action, and API access:
      </p>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0; font-family: monospace; font-size: 14px; word-break: break-all;">
        ${escapeHtml(apiKey)}
      </div>
      <p style="color: #374151; line-height: 1.6;">
        <strong>Keep this key safe.</strong> You can view it anytime in your
        <a href="https://cullit.io/dashboard.html" style="color: #5eead4;">dashboard</a>.
      </p>
      <p style="color: #374151; line-height: 1.6; margin-top: 16px;">
        Get started:
      </p>
      <pre style="background: #1f2937; color: #d1d5db; padding: 16px; border-radius: 8px; font-size: 13px; overflow-x: auto;">npm install -g cullit
export CULLIT_API_KEY="${escapeHtml(apiKey)}"
cullit generate --from v1.0.0</pre>
      <p style="color: #374151; line-height: 1.6; margin-top: 16px;">
        <a href="https://cullit.io/docs.html" style="color: #5eead4;">Read the docs</a> &middot;
        <a href="https://cullit.io/tutorial.html" style="color: #5eead4;">Interactive tutorial</a>
      </p>
    ${FOOTER}`,
  });
}

const PLAN_DETAILS: Record<string, { label: string; features: string[] }> = {
  basic: {
    label: 'Basic ($4/mo)',
    features: [
      '50 generations/month',
      '10 projects',
      'AI generation (BYOK)',
      'Hosted changelog',
    ],
  },
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
  'team-5': {
    label: 'Team 5 ($44.99/mo)',
    features: [
      '5 API keys / seats',
      '2,000 generations/month',
      '250 projects',
      'All Pro features',
      'Team management dashboard',
    ],
  },
  'team-10': {
    label: 'Team 10 ($89/mo)',
    features: [
      '10 API keys / seats',
      '2,000 generations/month',
      '250 projects',
      'All Pro features',
      'GitLab & Bitbucket',
      'Priority support',
    ],
  },
  'team-25': {
    label: 'Team 25 ($209/mo)',
    features: [
      '25 API keys / seats',
      '2,000 generations/month',
      '250 projects',
      'All Pro features',
      'Confluence & Notion',
      'Priority support',
    ],
  },
};

export async function sendSubscriptionConfirmed(email: string, name: string, plan: string, apiKey?: string): Promise<boolean> {
  const details = PLAN_DETAILS[plan] || PLAN_DETAILS.pro;
  const displayName = plan.startsWith('team') ? 'Team' : plan.charAt(0).toUpperCase() + plan.slice(1);
  return send({
    to: email,
    subject: `You're on Cullit ${displayName}!`,
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Subscription confirmed</h2>
      <p style="color: #374151; line-height: 1.6;">
        Hi ${escapeHtml(name)}, your <strong>${details.label}</strong> subscription is now active.
      </p>
      <p style="color: #374151; line-height: 1.6;">
        You now have access to:
      </p>
      <ul style="color: #374151; line-height: 1.8; padding-left: 20px;">
        ${details.features.map(f => `<li>${f}</li>`).join('\n        ')}
      </ul>
      ${apiKey ? `
      <p style="color: #374151; line-height: 1.6; margin-top: 16px;">Your API key:</p>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 8px 0; font-family: monospace; font-size: 14px; word-break: break-all;">
        ${escapeHtml(apiKey)}
      </div>
      <p style="color: #6b7280; font-size: 13px;">Use this key with the CLI, GitHub Action, or API. Keep it safe.</p>
      ` : ''}
      <p style="color: #374151; line-height: 1.6;">
        Manage your subscription anytime from the
        <a href="https://cullit.io/dashboard.html" style="color: #5eead4;">dashboard billing tab</a>.
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

export async function sendTeamApiKey(email: string, recipientName: string, orgName: string, senderName: string, apiKey: string, label: string): Promise<boolean> {
  return send({
    to: email,
    subject: `Your Cullit API key for ${orgName}`,
    html: `${BRAND}
      <h2 style="color: #0f1117; margin-bottom: 16px;">Your team API key</h2>
      <p style="color: #374151; line-height: 1.6;">
        Hi ${escapeHtml(recipientName)}, ${escapeHtml(senderName)} has assigned you an API key for <strong>${escapeHtml(orgName)}</strong>${label ? ` (${escapeHtml(label)})` : ''}.
      </p>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0; font-family: monospace; font-size: 14px; word-break: break-all;">
        ${escapeHtml(apiKey)}
      </div>
      <p style="color: #374151; line-height: 1.6;">
        Use this key with the CLI, GitHub Action, or API:
      </p>
      <pre style="background: #1f2937; color: #d1d5db; padding: 16px; border-radius: 8px; font-size: 13px; overflow-x: auto;">export CULLIT_API_KEY="${escapeHtml(apiKey)}"
cullit generate --from v1.0.0</pre>
      <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
        <strong>Keep this key safe.</strong> If you believe it has been compromised, ask your team admin to rotate it.
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

export function isEmailConfigured(): boolean {
  return !!RESEND_API_KEY;
}
