// Shared Miniflux connection config + auth header builder. Supports either an
// API token (sent as X-Auth-Token) or HTTP Basic auth with the admin
// credentials — selected by which env vars are set. Token takes precedence.
//
//   MINIFLUX_URL=http://localhost:8080
//   MINIFLUX_TOKEN=...                       # option (a): API key
//   MINIFLUX_USERNAME=admin / MINIFLUX_PASSWORD=...  # option (b): basic auth

export function minifluxBaseUrl() {
  return process.env.MINIFLUX_URL;
}

export function minifluxAuthHeaders() {
  const token = process.env.MINIFLUX_TOKEN;
  if (token) return { 'X-Auth-Token': token };
  const user = process.env.MINIFLUX_USERNAME;
  const pass = process.env.MINIFLUX_PASSWORD;
  if (user && pass) {
    return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
  }
  return null;
}

export function minifluxConfigured() {
  return Boolean(minifluxBaseUrl() && minifluxAuthHeaders());
}
