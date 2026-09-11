export const SERVICES = [
  'retaining_walls',
  'excavation',
  'concrete',
  'driveways',
  'other',
] as const;

export const STATUSES = ['new', 'contacted', 'scheduled', 'closed', 'declined'] as const;
export const CONTACT_METHODS = ['phone', 'email', 'either'] as const;

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

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateEstimate(input: {
  name: string;
  email: string;
  phone: string;
  service: string;
  location: string;
  description: string;
  preferredContact: string;
}): void {
  const name = normalizeText(input.name);
  const email = normalizeText(input.email).toLowerCase();
  const phone = normalizeText(input.phone);
  const location = normalizeText(input.location);
  const description = input.description.trim();

  if (name.length < 2 || name.length > 100) throw new Error('Name must be between 2 and 100 characters');
  if (!email && !phone) throw new Error('Provide at least one of email or phone');
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Email is invalid');
  if (phone.length > 40) throw new Error('Phone is too long');
  if (!SERVICES.includes(input.service as (typeof SERVICES)[number])) throw new Error('Service is invalid');
  if (location.length > 160) throw new Error('Location is too long');
  if (description.length < 10 || description.length > 4000) throw new Error('Project description must be between 10 and 4000 characters');
  if (!CONTACT_METHODS.includes(input.preferredContact as (typeof CONTACT_METHODS)[number])) throw new Error('Preferred contact method is invalid');
  if (input.preferredContact === 'phone' && !phone) throw new Error('A phone number is required for phone contact');
  if (input.preferredContact === 'email' && !email) throw new Error('An email is required for email contact');
}

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
