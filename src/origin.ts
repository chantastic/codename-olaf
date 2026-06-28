function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function publicOrigin(request: Request): string {
  const url = new URL(request.url);

  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    return `https://${url.host}`;
  }

  return url.origin;
}
