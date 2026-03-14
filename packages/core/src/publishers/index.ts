import { writeFileSync } from 'fs';
import type { Publisher, ReleaseNotes, OutputFormat } from '../types';
import { formatNotes } from '../formatter';

/**
 * Outputs release notes to stdout (default).
 */
export class StdoutPublisher implements Publisher {
  async publish(notes: ReleaseNotes, format: OutputFormat): Promise<void> {
    const formatted = formatNotes(notes, format);
    console.log(formatted);
  }
}

/**
 * Writes release notes to a file.
 */
export class FilePublisher implements Publisher {
  constructor(private path: string) {}

  async publish(notes: ReleaseNotes, format: OutputFormat): Promise<void> {
    const formatted = formatNotes(notes, format);
    writeFileSync(this.path, formatted, 'utf-8');
    console.log(`✓ Release notes written to ${this.path}`);
  }
}
