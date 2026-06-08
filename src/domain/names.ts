export function normalizeHumanName(input: string): string {
  const collapsed = input.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";

  return collapsed
    .split(" ")
    .map((word) => {
      if (/^[A-Z0-9]+$/.test(word) && /[A-Z]/.test(word)) return word;
      const first = word.slice(0, 1).toUpperCase();
      const rest = word.slice(1).toLowerCase();
      return `${first}${rest}`;
    })
    .join(" ");
}
