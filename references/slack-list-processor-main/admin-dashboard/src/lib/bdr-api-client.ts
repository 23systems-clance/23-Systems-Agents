import axios from 'axios';

const API_BASE = '/api/v1/bdr';

export const bdrApi = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

/**
 * On the first request, forward the magic link token from the browser URL
 * so the backend can validate the JWT and establish a session cookie.
 * After the first successful response, the token is cleared from the URL
 * and subsequent requests rely on the session cookie.
 */
let tokenForwarded = false;

bdrApi.interceptors.request.use((config) => {
  if (!tokenForwarded) {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      config.params = { ...config.params, token };
    }
  }
  return config;
});

bdrApi.interceptors.response.use(
  (response) => {
    // After first successful response, session cookie is set.
    // Strip the token from the browser URL for cleanliness.
    if (!tokenForwarded) {
      tokenForwarded = true;
      const url = new URL(window.location.href);
      if (url.searchParams.has('token')) {
        url.searchParams.delete('token');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    }
    return response;
  },
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401
    ) {
      // BDR needs a new magic link from Slack
      window.location.href = '/bdr/auth-required';
    }
    return Promise.reject(error);
  },
);
