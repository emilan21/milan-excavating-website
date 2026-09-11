import { describe, expect, it } from 'vitest';
import { canTransition, hasAdminAccount, isIsoDate, isValidAdminEmail, isValidGithubUsername, normalizeAdminEmail, normalizeGithubUsername } from '../src/validation';

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
  const email = 'owner@example.com';
  const username = 'owner-account';
  it('requires the issuer, audience, verified email, and GitHub username together', () => {
    const auth = { isInternal: false, jwt: { issuer, audience: [audience], fullPayload: { email: 'Owner@Example.com', email_verified: true, preferred_username: 'Owner-Account' } } };
    expect(hasAdminAccount(auth, issuer, audience, email, username)).toBe(true);
    expect(hasAdminAccount({ ...auth, jwt: { ...auth.jwt, audience: ['wrong'] } }, issuer, audience, email, username)).toBe(false);
    expect(hasAdminAccount({ ...auth, jwt: { ...auth.jwt, fullPayload: { email: 'other@example.com', email_verified: true, preferred_username: username } } }, issuer, audience, email, username)).toBe(false);
    expect(hasAdminAccount({ ...auth, jwt: { ...auth.jwt, fullPayload: { email, email_verified: false, preferred_username: username } } }, issuer, audience, email, username)).toBe(false);
    expect(hasAdminAccount({ ...auth, jwt: { ...auth.jwt, fullPayload: { email, email_verified: true } } }, issuer, audience, email, username)).toBe(false);
    expect(hasAdminAccount({ isInternal: false, jwt: null }, issuer, audience, email, username)).toBe(false);
  });

  it('normalizes and validates configured admin email addresses', () => {
    expect(normalizeAdminEmail(' Owner@Example.com ')).toBe(email);
    expect(isValidAdminEmail(email)).toBe(true);
    expect(isValidAdminEmail('not-an-email')).toBe(false);
    expect(normalizeGithubUsername(' Owner-Account ')).toBe(username);
    expect(isValidGithubUsername(username)).toBe(true);
    expect(isValidGithubUsername('-not-valid')).toBe(false);
  });
});

describe('visit dates', () => {
  it('accepts real ISO UTC dates only', () => {
    expect(isIsoDate('2026-09-10')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('09/10/2026')).toBe(false);
  });
});
