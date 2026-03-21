import axios from 'axios';

const API_BASE = '/api/v1/admin';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

/** On 401 response, redirect to login (session expired or not authenticated). */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !error.config?.url?.includes('/auth/')
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
