import type {
  Generator, EnrichedContext, AIConfig, ReleaseNotes,
  ChangeEntry, ChangeCategory, OpenClawConfig
} from '@cullit/core';
import { fetchWithTimeout } from '@cullit/core';

/**
 * Generates release notes using AI.
 * Supports Anthropic, OpenAI, Gemini, Ollama, OpenClaw — BYOK.
 */
export class AIGenerator implements Generator {
  private openclawConfig?: OpenClawConfig;
  private timeoutMs: number;

  constructor(openclawConfig?: OpenClawConfig, timeoutMs: number = 60_000) {
    this.openclawConfig = openclawConfig;
    this.timeoutMs = timeoutMs;
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    return fetchWithTimeout(url, init, this.timeoutMs);
  }

  async generate(context: EnrichedContext, config: AIConfig): Promise<ReleaseNotes> {
    const prompt = this.buildPrompt(context, config);
    const apiKey = this.resolveApiKey(config);
    const maxTokens = config.maxTokens || 4096;

    let rawResponse: string;

    if (config.provider === 'anthropic') {
      rawResponse = await this.callAnthropic(prompt, apiKey, config.model, maxTokens);
    } else if (config.provider === 'openai') {
      rawResponse = await this.callOpenAI(prompt, apiKey, config.model, maxTokens);
    } else if (config.provider === 'gemini') {
      rawResponse = await this.callGemini(prompt, apiKey, config.model, maxTokens);
    } else if (config.provider === 'ollama') {
      rawResponse = await this.callOllama(prompt, config.model);
    } else if (config.provider === 'openclaw') {
      rawResponse = await this.callOpenClaw(prompt, config.model, maxTokens);
    } else {
      throw new Error(`Unsupported AI provider: ${config.provider}`);
    }

    return this.parseResponse(rawResponse, context);
  }

  private resolveApiKey(config: AIConfig): string {
    if (config.apiKey) return config.apiKey;

    // Ollama and OpenClaw don't require API keys
    if (config.provider === 'ollama' || config.provider === 'openclaw') return '';

    const envVarMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      gemini: 'GOOGLE_API_KEY',
    };

    const envVar = envVarMap[config.provider];
    if (!envVar) throw new Error(`Unknown provider: ${config.provider}`);

    const key = process.env[envVar];
    if (!key) {
      throw new Error(
        `No API key found. Set ${envVar} in your environment or ` +
        `provide it in .cullit.yml under ai.apiKey`
      );
    }
    return key;
  }

  private buildPrompt(context: EnrichedContext, config: AIConfig): string {
    const { diff, tickets } = context;

    const commitList = diff.commits
      .map(c => {
        let line = `- ${c.shortHash}: ${c.message}`;
        if (c.issueKeys?.length) line += ` [${c.issueKeys.join(', ')}]`;
        return line;
      })
      .join('\n');

    const ticketList = tickets.length > 0
      ? tickets.map(t =>
          `- ${t.key}: ${t.title}${t.type ? ` (${t.type})` : ''}${t.labels?.length ? ` [${t.labels.join(', ')}]` : ''}`
        ).join('\n')
      : 'No enrichment data available.';

    const audienceInstructions: Record<string, string> = {
      'developer': 'Write for developers. Include technical details, API changes, and migration notes.',
      'end-user': 'Write for end users. Use plain language. Focus on benefits and behavior changes. No jargon.',
      'executive': 'Write a brief executive summary. Focus on business impact, key metrics, and strategic changes.',
    };

    const toneInstructions: Record<string, string> = {
      'professional': 'Tone: professional and clear.',
      'casual': 'Tone: conversational and approachable, but still informative.',
      'terse': 'Tone: minimal and direct. Short bullet points only.',
    };

    const categories = config.categories.join(', ');

    return `You are a release notes generator. Analyze the following git commits and related tickets, then produce structured release notes.

## Input

### Commits (${diff.from} → ${diff.to})
${commitList}

### Related Tickets
${ticketList}

## Instructions

${audienceInstructions[config.audience]}
${toneInstructions[config.tone]}

Categorize each change into one of: ${categories}

## Output Format

Respond with ONLY valid JSON (no markdown, no backticks, no preamble):
{
  "summary": "One paragraph summarizing this release",
  "changes": [
    {
      "description": "Human-readable description of the change",
      "category": "features|fixes|breaking|improvements|chores",
      "ticketKey": "PROJ-123 or null"
    }
  ]
}

Rules:
- Combine related commits into single change entries
- Skip trivial commits (merge commits, formatting, typos) unless they fix bugs
- Each description should be one clear sentence
- Include ticket keys when available
- Group by category
- Maximum 20 change entries
- If a commit message mentions a breaking change, categorize it as "breaking"`;
  }

  private async callAnthropic(prompt: string, apiKey: string, model?: string, maxTokens: number = 4096): Promise<string> {
    const response = await this.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.content[0]?.text || '';
  }

  private async callOpenAI(prompt: string, apiKey: string, model?: string, maxTokens: number = 4096): Promise<string> {
    const response = await this.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.choices[0]?.message?.content || '';
  }

  private async callGemini(prompt: string, apiKey: string, model?: string, maxTokens: number = 4096): Promise<string> {
    const modelId = model || 'gemini-2.0-flash';
    const response = await this.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  private async callOllama(prompt: string, model?: string): Promise<string> {
    const baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const response = await this.fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.1',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.3 },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.message?.content || '';
  }

  private async callOpenClaw(prompt: string, model?: string, maxTokens: number = 4096): Promise<string> {
    const baseUrl = this.openclawConfig?.baseUrl || process.env.OPENCLAW_URL || 'http://localhost:18789';
    const token = this.openclawConfig?.token || process.env.OPENCLAW_TOKEN || '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await this.fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'anthropic/claude-sonnet-4-6',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenClaw API error (${response.status}): ${error}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }

  private parseResponse(raw: string, context: EnrichedContext): ReleaseNotes {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let parsed: { summary?: string; changes: Array<{ description: string; category: string; ticketKey?: string }> };

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse AI response as JSON. Raw response:\n${raw.substring(0, 500)}`);
    }

    const validCategories = new Set(['features', 'fixes', 'breaking', 'improvements', 'chores', 'other']);

    const changes: ChangeEntry[] = (parsed.changes || []).map(c => ({
      description: c.description,
      category: (validCategories.has(c.category) ? c.category : 'other') as ChangeCategory,
      ticketKey: c.ticketKey || undefined,
    }));

    const contributors = [...new Set(context.diff.commits.map(c => c.author))];

    return {
      version: context.diff.to,
      date: new Date().toISOString().split('T')[0],
      summary: parsed.summary,
      changes,
      contributors,
      metadata: {
        commitCount: context.diff.commits.length,
        prCount: context.diff.commits.filter(c => c.prNumber).length,
        ticketCount: context.tickets.length,
        generatedBy: 'cullit',
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
