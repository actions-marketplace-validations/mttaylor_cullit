export interface ResolvedActionRefs {
  from: string;
  to: string;
  autoDetected: boolean;
}

export function resolveActionRefs(fromInput: string, toInput: string | undefined, tags: string[]): ResolvedActionRefs {
  const to = toInput || 'HEAD';

  if (fromInput) {
    return { from: fromInput, to, autoDetected: false };
  }

  if (tags.length === 0) {
    throw new Error('Input "from" was omitted, but no tags were found. Specify "from" explicitly or create a tag first.');
  }

  if (to === 'HEAD') {
    return { from: tags[0], to, autoDetected: true };
  }

  const tagIndex = tags.indexOf(to);
  if (tagIndex >= 0) {
    if (tagIndex + 1 >= tags.length) {
      throw new Error(`Input "from" was omitted, but no previous tag exists before "${to}".`);
    }
    return { from: tags[tagIndex + 1], to, autoDetected: true };
  }

  return { from: tags[0], to, autoDetected: true };
}