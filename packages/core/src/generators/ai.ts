import type {
  Generator, EnrichedContext, AIConfig, ReleaseNotes,
  ChangeEntry, ChangeCategory
} from '../types';

/**
 * Generates release notes using AI (Claude or OpenAI).
 * Supports BYOK (Bring Your Own Key).
 */
export class AIGenerator implements Generator {

  async generate(context: EnrichedContext, config: AIConfig): Promise<ReleaseNotes> {
    const prompt = this.buildPrompt(context, config);
    const apiKey = this.resolveApiKey(config);

    let rawResponse: string;

    if (config.provider === 'anthropic') {
      rawResponse = await this.callAnthropic(prompt, apiKey, config.model);
    } else if (config.provider === 'openai') {
      rawResponse = await this.callOpenAI(prompt, apiKey, config.model);
    } else {
      throw new Error(`Unsupported AI provider: ${config.provider}`);
    }

    return this.parseResponse(rawResponse, context);
  }

  private resolveApiKey(config: AIConfig): string {
    if (config.apiKey) return config.apiKey;

    const envVar = config.provider === 'anthropic'
      ? 'ANTHROPIC_API_KEY'
      : 'OPENAI_API_KEY';

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

    const audienceInstructions = {
      'developer': 'Write for developers. Include technical details, API changes, and migration notes.',
      'end-user': 'Write for end users. Use plain language. Focus on benefits and behavior changes. No jargon.',
      'executive': 'Write a brief executive summary. Focus on business impact, key metrics, and strategic changes.',
    };

    const toneInstructions = {
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

  private async callAnthropic(prompt: string, apiKey: string, model?: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
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

  private async callOpenAI(prompt: string, apiKey: string, model?: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
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
        generatedBy: 'cull',
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
