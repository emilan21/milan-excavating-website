export const STATUSES = ['new', 'contacted', 'scheduled', 'closed', 'declined'] as const;

export type AuthContext = {
  isInternal: boolean;
  jwt: null | {
    issuer: string;
    audience: readonly string[];
    fullPayload: Record<string, unknown>;
  };
};

const STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  new: ['contacted', 'scheduled', 'declined'],
  contacted: ['scheduled', 'closed', 'declined'],
  scheduled: ['contacted', 'closed', 'declined'],
  closed: [],
  declined: [],
};

export function canTransition(from: string, to: string): boolean {
  return from === to || (STATUS_TRANSITIONS[from]?.includes(to) ?? false);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function hasAdminRole(auth: AuthContext, expectedIssuer: string, expectedAudience: string): boolean {
  if (auth.isInternal) return true;
  const jwt = auth.jwt;
  if (!jwt || jwt.issuer !== expectedIssuer || !jwt.audience.includes(expectedAudience)) return false;
  const roles = jwt.fullPayload.roles;
  return Array.isArray(roles) && roles.includes('admin');
}
