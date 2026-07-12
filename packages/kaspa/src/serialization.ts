export type JsonSafe =
  | boolean
  | JsonSafe[]
  | null
  | number
  | string
  | {
      [key: string]: JsonSafe;
    };

export function bigIntJsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function stringifyWithBigInts(value: unknown, space?: number): string {
  return JSON.stringify(value, bigIntJsonReplacer, space);
}

export function serializeBigInts(value: unknown): JsonSafe {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInts(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    ) as JsonSafe;
  }

  return null;
}
