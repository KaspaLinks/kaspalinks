type PrismaErrorLike = {
  code?: unknown;
  meta?: {
    target?: unknown;
  };
};

export function isPrismaUniqueConstraintError(error: unknown, fields?: string[]): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as PrismaErrorLike;
  if (candidate.code !== "P2002") {
    return false;
  }

  if (!fields || fields.length === 0) {
    return true;
  }

  const target = candidate.meta?.target;
  if (!Array.isArray(target)) {
    return false;
  }

  return fields.every((field) => target.includes(field));
}
