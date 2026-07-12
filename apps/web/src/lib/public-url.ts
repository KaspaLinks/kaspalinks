const DEFAULT_PUBLIC_APP_URL = "https://kaspalinks.com";

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicAppBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const normalized = normalizeBaseUrl(configured);
    if (normalized) {
      return normalized;
    }
  }

  const requestOrigin = normalizeBaseUrl(new URL(request.url).origin);
  return requestOrigin ?? DEFAULT_PUBLIC_APP_URL;
}

export function absolutePublicUrl(request: Request, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getPublicAppBaseUrl(request)}${normalizedPath}`;
}
