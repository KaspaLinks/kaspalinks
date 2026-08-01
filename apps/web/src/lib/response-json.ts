export async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const rawBody = await response.text();
  if (!rawBody.trim()) return null;

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    return null;
  }
}
