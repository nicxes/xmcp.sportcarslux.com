const GRAPH = "https://graph.facebook.com/v21.0";

export async function graph<T>(
  path: string,
  token: string,
  params: Record<string, string> = {}
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const body = (await res.json()) as T & { error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body;
}
