import { writeFileSync } from 'fs';
import { resolve, relative, isAbsolute } from 'path';
import type { Publisher, ReleaseNotes, OutputFormat } from '../types';
import { formatNotes } from '../formatter';
import { CullitError, CoreErrorCode } from '../errors';

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
  constructor(private path: string) {
    // Validate path stays within CWD to prevent path traversal
    const resolved = resolve(path);
    const cwd = resolve('.');
    const rel = relative(cwd, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new CullitError(CoreErrorCode.PUBLISHER_PATH_TRAVERSAL, `File output path must be within the project directory. Got: ${path}`);
    }
  }

  async publish(notes: ReleaseNotes, format: OutputFormat, preformatted?: string): Promise<void> {
    const output = preformatted || formatNotes(notes, format);
    writeFileSync(this.path, output, 'utf-8');
    console.log(`✓ Release notes written to ${this.path}`);
  }
}
