import { SenderError, schema, table, t } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { canTransition, hasAdminRole, isIsoDate, STATUSES, type AuthContext } from './validation';

const ADMIN_SCOPE = 'admin';
const SPACETIMEAUTH_ISSUER = 'https://auth.spacetimedb.com/oidc';

const moduleOwner = table(
  { name: 'module_owner' },
  { identity: t.identity().primaryKey() }
);

const securityConfig = table(
  { name: 'security_config' },
  {
    key: t.u8().primaryKey(),
    oidcAudience: t.string(),
  }
);

const gatewayIdentity = table(
  { name: 'gateway_identity' },
  { identity: t.identity().primaryKey() }
);

const adminSession = table(
  { name: 'admin_session' },
  {
    identity: t.identity().primaryKey(),
    connections: t.u32(),
  }
);

const estimateRequest = table(
  { name: 'estimate_request' },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    email: t.string(),
    phone: t.string(),
    service: t.string().index('btree'),
    location: t.string(),
    description: t.string(),
    preferredContact: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    status: t.string().index('btree'),
    adminNotes: t.string(),
    adminScope: t.string().index('btree'),
  }
);

const dailyVisit = table(
  { name: 'daily_visit' },
  {
    date: t.string().primaryKey(),
    total: t.u64(),
    adminScope: t.string().index('btree'),
  }
);

const lifetimeVisit = table(
  { name: 'lifetime_visit' },
  {
    key: t.u8().primaryKey(),
    total: t.u64(),
    adminScope: t.string().index('btree'),
  }
);

const migrationState = table(
  { name: 'migration_state' },
  {
    key: t.u8().primaryKey(),
    legacyTotalImported: t.bool(),
  }
);

const spacetimedb = schema({
  moduleOwner,
  securityConfig,
  gatewayIdentity,
  adminSession,
  estimateRequest,
  dailyVisit,
  lifetimeVisit,
  migrationState,
});

export default spacetimedb;

function hasAdminClaim(auth: AuthContext, audience: string): boolean {
  return hasAdminRole(auth, SPACETIMEAUTH_ISSUER, audience);
}

function isOwner(ctx: { sender: Identity; db: any }): boolean {
  return ctx.db.moduleOwner.identity.find(ctx.sender) !== undefined;
}

function requireOwner(ctx: { sender: Identity; db: any }): void {
  if (!isOwner(ctx)) throw new SenderError('Unauthorized: module owner required');
}

function requireAdmin(ctx: { senderAuth: AuthContext; db: any }): void {
  const config = ctx.db.securityConfig.key.find(0);
  if (!config || !hasAdminClaim(ctx.senderAuth, config.oidcAudience)) {
    throw new SenderError('Unauthorized: admin role required');
  }
}

function requireGateway(ctx: { sender: Identity; db: any }): void {
  if (ctx.db.gatewayIdentity.identity.find(ctx.sender) === undefined) {
    throw new SenderError('Unauthorized: gateway identity required');
  }
}

export const init = spacetimedb.init(ctx => {
  ctx.db.moduleOwner.insert({ identity: ctx.sender });
  ctx.db.lifetimeVisit.insert({ key: 0, total: 0n, adminScope: ADMIN_SCOPE });
  ctx.db.migrationState.insert({ key: 0, legacyTotalImported: false });
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const config = ctx.db.securityConfig.key.find(0);
  if (!config || !hasAdminClaim(ctx.senderAuth, config.oidcAudience)) return;
  const session = ctx.db.adminSession.identity.find(ctx.sender);
  if (session) ctx.db.adminSession.identity.update({ ...session, connections: session.connections + 1 });
  else ctx.db.adminSession.insert({ identity: ctx.sender, connections: 1 });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const session = ctx.db.adminSession.identity.find(ctx.sender);
  if (!session) return;
  if (session.connections > 1) ctx.db.adminSession.identity.update({ ...session, connections: session.connections - 1 });
  else ctx.db.adminSession.identity.delete(ctx.sender);
});

export const configureSecurity = spacetimedb.reducer(
  { gateway: t.identity(), oidcAudience: t.string() },
  (ctx, { gateway, oidcAudience }) => {
    requireOwner(ctx);
    const audience = oidcAudience.trim();
    if (!/^client_[A-Za-z0-9]+$/.test(audience)) throw new SenderError('Invalid SpacetimeAuth audience');
    for (const row of ctx.db.gatewayIdentity.iter()) ctx.db.gatewayIdentity.identity.delete(row.identity);
    ctx.db.gatewayIdentity.insert({ identity: gateway });
    const current = ctx.db.securityConfig.key.find(0);
    if (current) ctx.db.securityConfig.key.update({ key: 0, oidcAudience: audience });
    else ctx.db.securityConfig.insert({ key: 0, oidcAudience: audience });
  }
);

export const importLegacyVisitTotal = spacetimedb.reducer(
  { total: t.u64() },
  (ctx, { total }) => {
    requireOwner(ctx);
    const state = ctx.db.migrationState.key.find(0);
    if (!state || state.legacyTotalImported) throw new SenderError('Legacy total has already been imported');
    const current = ctx.db.lifetimeVisit.key.find(0);
    if (!current || current.total !== 0n) throw new SenderError('Visit tracking has already started');
    ctx.db.lifetimeVisit.key.update({ ...current, total });
    ctx.db.migrationState.key.update({ key: 0, legacyTotalImported: true });
  }
);

export const createEstimate = spacetimedb.reducer(
  {
    name: t.string(),
    email: t.string(),
    phone: t.string(),
    service: t.string(),
    location: t.string(),
    description: t.string(),
    preferredContact: t.string(),
  },
  (ctx, input) => {
    requireGateway(ctx);
    void input;
    throw new SenderError('Online estimate requests are disabled; please call the business');
  }
);

export const recordVisit = spacetimedb.reducer(
  { date: t.string() },
  (ctx, { date }) => {
    requireGateway(ctx);
    if (!isIsoDate(date)) throw new SenderError('Invalid visit date');
    const day = ctx.db.dailyVisit.date.find(date);
    if (day) ctx.db.dailyVisit.date.update({ ...day, total: day.total + 1n });
    else ctx.db.dailyVisit.insert({ date, total: 1n, adminScope: ADMIN_SCOPE });
    const lifetime = ctx.db.lifetimeVisit.key.find(0);
    if (!lifetime) throw new Error('Lifetime visit row is missing');
    ctx.db.lifetimeVisit.key.update({ ...lifetime, total: lifetime.total + 1n });
  }
);

export const changeEstimateStatus = spacetimedb.reducer(
  { id: t.u64(), status: t.string() },
  (ctx, { id, status }) => {
    requireAdmin(ctx);
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) throw new SenderError('Invalid status');
    const estimate = ctx.db.estimateRequest.id.find(id);
    if (!estimate) throw new SenderError('Estimate request not found');
    if (!canTransition(estimate.status, status)) throw new SenderError(`Cannot transition from ${estimate.status} to ${status}`);
    ctx.db.estimateRequest.id.update({ ...estimate, status, updatedAt: ctx.timestamp });
  }
);

export const updateEstimateNotes = spacetimedb.reducer(
  { id: t.u64(), notes: t.string() },
  (ctx, { id, notes }) => {
    requireAdmin(ctx);
    if (notes.length > 8000) throw new SenderError('Notes are too long');
    const estimate = ctx.db.estimateRequest.id.find(id);
    if (!estimate) throw new SenderError('Estimate request not found');
    ctx.db.estimateRequest.id.update({ ...estimate, adminNotes: notes.trim(), updatedAt: ctx.timestamp });
  }
);

export const adminEstimates = spacetimedb.view(
  { name: 'admin_estimates', public: true },
  t.array(estimateRequest.rowType),
  ctx => {
    if (!ctx.db.adminSession.identity.find(ctx.sender)) return [];
    return Array.from(ctx.db.estimateRequest.adminScope.filter(ADMIN_SCOPE));
  }
);

export const adminDailyVisits = spacetimedb.view(
  { name: 'admin_daily_visits', public: true },
  t.array(dailyVisit.rowType),
  ctx => {
    if (!ctx.db.adminSession.identity.find(ctx.sender)) return [];
    return Array.from(ctx.db.dailyVisit.adminScope.filter(ADMIN_SCOPE));
  }
);

export const adminLifetimeVisits = spacetimedb.view(
  { name: 'admin_lifetime_visits', public: true },
  t.array(lifetimeVisit.rowType),
  ctx => {
    if (!ctx.db.adminSession.identity.find(ctx.sender)) return [];
    return Array.from(ctx.db.lifetimeVisit.adminScope.filter(ADMIN_SCOPE));
  }
);
