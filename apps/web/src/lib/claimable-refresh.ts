export function selectRotatingWindow<T>(
  items: T[],
  cursor: number,
  limit: number,
): { items: T[]; nextCursor: number } {
  if (items.length === 0 || limit <= 0) return { items: [], nextCursor: 0 };
  const start = Math.max(0, Math.floor(cursor)) % items.length;
  const count = Math.min(Math.floor(limit), items.length);
  const selected = Array.from(
    { length: count },
    (_, index) => items[(start + index) % items.length]!,
  );
  return {
    items: selected,
    nextCursor: (start + count) % items.length,
  };
}
