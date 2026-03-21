import axios from 'axios';

const API_BASE = '/api/v1/dialer';

export const dialerApi = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Copy the same token-forwarding pattern from bdr-api-client.ts
let tokenForwarded = false;

dialerApi.interceptors.request.use((config) => {
  if (!tokenForwarded) {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      config.params = { ...config.params, token };
    }
  }
  return config;
});

dialerApi.interceptors.response.use(
  (response) => {
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
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      window.location.href = '/bdr/auth-required';
    }
    return Promise.reject(error);
  },
);
