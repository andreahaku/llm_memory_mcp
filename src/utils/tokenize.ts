export function splitCamelCase(s: string): string[] {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/);
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  const parts = splitCamelCase(text)
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter(Boolean);
  return parts;
}

