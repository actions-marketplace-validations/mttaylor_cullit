import { writeFileSync } from 'fs';
import type { Publisher, ReleaseNotes, OutputFormat } from '../types';
import { formatNotes } from '../formatter';

/**
 * Outputs release notes to stdout (default).
 */
export class StdoutPublisher implements Publisher {
  async publish(notes: ReleaseNotes, format: OutputFormat, preformatted?: string): Promise<void> {
    console.log(preformatted || formatNotes(notes, format));
  }
}

/**
 * Writes release notes to a file.
 */
export class FilePublisher implements Publisher {
  constructor(private path: string) {}

  async publish(notes: ReleaseNotes, format: OutputFormat, preformatted?: string): Promise<void> {
    const output = preformatted || formatNotes(notes, format);
    writeFileSync(this.path, output, 'utf-8');
    console.log(`✓ Release notes written to ${this.path}`);
  }
}
