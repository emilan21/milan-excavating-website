import { describe, expect, it } from 'vitest';
import { canTransition, hasAdminRole, isIsoDate, validateEstimate } from '../src/validation';

const validEstimate = {
  name: 'Terry Milan', email: 'terry@example.com', phone: '', service: 'excavation',
  location: 'Uniontown, PA', description: 'Excavate and prepare a new foundation area.', preferredContact: 'email',
};

describe('estimate validation', () => {
  it('accepts every supported service including other', () => {
    for (const service of ['retaining_walls', 'excavation', 'concrete', 'driveways', 'other']) {
      expect(() => validateEstimate({ ...validEstimate, service })).not.toThrow();
    }
  });

  it('requires a name, description, and one contact channel', () => {
    expect(() => validateEstimate({ ...validEstimate, name: '' })).toThrow(/Name/);
    expect(() => validateEstimate({ ...validEstimate, description: 'short' })).toThrow(/description/);
    expect(() => validateEstimate({ ...validEstimate, email: '', phone: '' })).toThrow(/at least one/);
  });
});

describe('lead status transitions', () => {
  it('allows the working lifecycle and rejects reopening terminal leads', () => {
    expect(canTransition('new', 'contacted')).toBe(true);
    expect(canTransition('contacted', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'closed')).toBe(true);
    expect(canTransition('closed', 'new')).toBe(false);
    expect(canTransition('declined', 'contacted')).toBe(false);
  });
});

describe('authorization claims', () => {
  const issuer = 'https://auth.spacetimedb.com/oidc';
  const audience = 'client_example';
  it('requires the issuer, audience, and admin role together', () => {
    const auth = { isInternal: false, jwt: { issuer, audience: [audience], fullPayload: { roles: ['admin'] } } };
    expect(hasAdminRole(auth, issuer, audience)).toBe(true);
    expect(hasAdminRole({ ...auth, jwt: { ...auth.jwt, audience: ['wrong'] } }, issuer, audience)).toBe(false);
    expect(hasAdminRole({ ...auth, jwt: { ...auth.jwt, fullPayload: { roles: ['user'] } } }, issuer, audience)).toBe(false);
    expect(hasAdminRole({ isInternal: false, jwt: null }, issuer, audience)).toBe(false);
  });
});

describe('visit dates', () => {
  it('accepts real ISO UTC dates only', () => {
    expect(isIsoDate('2026-09-10')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('09/10/2026')).toBe(false);
  });
});
