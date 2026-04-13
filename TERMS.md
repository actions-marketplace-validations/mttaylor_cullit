# Terms of Service

**Last updated:** March 27, 2026

## 1. Acceptance

By using Cullit (the "Service"), you agree to these Terms.

Cullit includes source-available packages and hosted services (such as the dashboard and billing flows). All usage is governed by these Terms and the [LICENSE](LICENSE) file.

## 2. License

Cullit source code is provided under the terms described in the [LICENSE](LICENSE) file. Your rights to use, modify, and distribute the software are governed by that license.

## 3. Account and Access

When using hosted features (for example dashboard login, billing, and team workflows), you are responsible for:

- Maintaining access to your GitHub account used for authentication
- Protecting API keys and credentials associated with your environment
- Keeping team membership and permissions accurate

## 4. BYOK (Bring Your Own Key)

Cullit supports AI provider keys you supply (Anthropic, OpenAI, Google Gemini, Ollama, and others). You are responsible for:

- Obtaining and managing your own provider credentials
- Complying with provider terms and policies
- All provider-side usage fees and charges

## 5. Billing and Subscriptions

Paid plans (Paid and Enterprise) include recurring billing through Stripe.

- You authorize recurring charges for selected paid plans
- Subscription changes, cancellations, and renewals are managed via Stripe/customer portal flows
- Plan limits, seat limits, and feature access may vary by tier
- All fees are non-refundable except as required by applicable law

## 5.1 Cancellation

- You may cancel at any time from the billing portal
- Access to paid features continues through the current billing period
- Partial billing periods are not prorated or refunded

## 6. Acceptable Use

You agree not to use Cullit for unlawful activity, abuse of third-party APIs, or any behavior that violates applicable law or third-party platform terms.

## 7. No Warranty

THE SOFTWARE AND SERVICE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

## 8. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, CULLIT, ITS AUTHORS, AND CONTRIBUTORS SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, OR FOR LOSS OF PROFITS, DATA, OR GOODWILL.

## 9. Data Processing

Cullit processes data from your configured sources and selected AI providers.

- Data handling differs across local CLI, self-hosted API, and hosted dashboard modes
- See [PRIVACY.md](PRIVACY.md) for current details

### 9.1 Data Retention

| Mode | Data Stored | Retention |
|------|-------------|-----------|
| **CLI / local** | None — all processing is ephemeral on your machine | N/A |
| **Self-hosted API** | As configured by you in your database | You control retention and backup |
| **Hosted dashboard** | Account info, generation history, team membership, billing state | Retained while your account is active |

Hosted dashboard generation history is retained for **90 days** by default and can be manually deleted at any time via the dashboard or API (`DELETE /auth/me`).

### 9.2 Data Deletion

You may delete your account and all associated data at any time:

- **Dashboard**: Settings → Delete Account
- **API**: `DELETE /auth/me` with a valid session or API key
- **Email**: Contact matt@cullit.io

Account deletion is permanent and removes all personal data, team memberships, drafts, project settings, and billing associations. Generation history is anonymized (aggregate statistics retained without personally identifiable information).

Deletion is processed immediately. If you believe deletion was incomplete, contact matt@cullit.io.

### 9.3 Third-Party Data Processors

When using the hosted dashboard, the following third-party services process data on behalf of Cullit:

| Service | Purpose | Data Shared |
|---------|---------|-------------|
| WorkOS | Authentication | Email, name (via GitHub OAuth) |
| Stripe | Billing | Email, subscription state |
| Railway | Hosting | Encrypted at rest, access-controlled |
| AI Providers | Generation | Commit messages, issue summaries (your choice of provider) |

Cullit does not sell, share, or distribute your data to third parties beyond what is required for service operation.

## 10. Enterprise Terms

Enterprise plans may be governed by separate agreements (for example SLA, security questionnaire terms, procurement terms).

## 11. Changes

We may update these Terms from time to time. Continued use after updates constitutes acceptance of the revised Terms.

## Contact

**Cullit**

- matt@cullit.io
- https://cullit.io
