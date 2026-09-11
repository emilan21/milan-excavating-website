export type MilanConfig = {
  apiBaseUrl: string;
  spacetimeUri: string;
  spacetimeDatabase: string;
  spacetimeAuthAuthority: string;
  spacetimeAuthClientId: string;
};

declare global {
  interface Window {
    MILAN_CONFIG: MilanConfig;
  }
}

export const config = window.MILAN_CONFIG;
