export type MilanConfig = { apiBaseUrl: string };

declare global {
  interface Window { MILAN_CONFIG: MilanConfig; }
}

export const config = window.MILAN_CONFIG;
