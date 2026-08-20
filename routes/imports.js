import { getDb } from '../server/db.js';
import { HttpError, json, withApiRoute } from '../server/http.js';
import { normalizeDomain, normalizeEmail, normalizeName, normalizePhone } from '../server/normalization.js';
import {
  validateAccount,
  validateContact,
  validateCustomer,
  validateImportRequest,
  validateLead,
} from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { consumeRateLimit } from '../server/rate-limit.js';

const IMPORT_RESOURCES = ['leads', 'contacts', 'accounts', 'customers'];

const RESOURCE_CONFIG = Object.freeze({
  leads: {
    label: 'leads',
    validate: validateLead,
    normalize(input) {
      return {
        ...input,
        notes: input.notes || [],
        reminders: input.reminders || [],
        quote_items: input.quote_items || [],
        normalized_email: normalizeEmail(input.email),
        normalized_phone: normalizePhone(input.phone),
      };
    },
  },
  contacts: {
    label: 'contacts',
    validate: validateContact,
    normalize(input) {
      return {
        ...input,
        normalized_email: normalizeEmail(input.email),
        normalized_phone: normalizePhone(input.phone),
      };
    },
  },
  accounts: {
    label: 'accounts',
    validate: validateAccount,
    normalize(input) {
      return {
        ...input,
        normalized_name: normalizeName(input.name),
        normalized_domain: normalizeDomain(input.domain),
      };
    },
  },
  customers: {
    label: 'customers',
    validate: validateCustomer,
    normalize(input) {
      return {
        ...input,
        normalized_email: normalizeEmail(input.email),
        normalized_phone: normalizePhone(input.phone),
      };
    },
  },
});

export default withApiRoute({
  methods: ['POST'],
  maxBodyBytes: 2 * 1024 * 1024,
  async handler({ req, res, userId }) {
    const input = validateImportRequest(req.body);
    const config = RESOURCE_CONFIG[input.resource];
    if (!config || !IMPORT_RESOURCES.includes(input.resource)) {
      throw new HttpError(400, 'invalid_resource', 'This resource cannot be imported.');
    }
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    await consumeRateLimit(sql, {
      workspaceId: workspace.id, subject: userId, scope: 'data_import', limit: 10, windowSeconds: 3600,
    });
    const plan = await buildImportPlan(sql, workspace.id, userId, input, config);

    if (input.mode !== 'import') {
      return json(res, 200, { data: formatImportResult(input, plan, input.mode) });
    }

    if (plan.errors.length > 0) {
      throw new HttpError(422, 'import_validation_failed', 'The import was not applied because validation or duplicate issues remain.', {
        summary: summarize(plan),
        errors: plan.errors,
        error_file: errorCsv(plan.errors),
      });
    }

    const queries = plan.rows.map(row => buildInsertQuery(sql, input.resource, workspace.id, userId, row));
    const results = await sql.transaction(queries);
    const ids = results.flatMap(result => result.map(item => item.id));
    return json(res, 201, {
      data: {
        ...formatImportResult(input, plan, input.mode),
        imported: ids.length,
        ids,
      },
    });
  },
});

async function buildImportPlan(sql, workspaceId, userId, input, config) {
  const members = await sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId}`;
  const memberIds = new Set(members.map(member => member.user_id));
  const normalizedRows = [];
  const errors = [];

  input.rows.forEach((rawRow, index) => {
    try {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        throw validationError(`Row ${index + 1} must be an object.`);
      }
      const mapped = mapImportRow(rawRow, input.mapping);
      const validated = config.validate(mapped);
      const normalized = config.normalize(validated);
      if ('owner_user_id' in normalized && normalized.owner_user_id && !memberIds.has(normalized.owner_user_id)) {
        throw validationError(`Row ${index + 1} references a user who is not a member of this workspace.`, 'owner_user_id');
      }
      if (input.resource === 'contacts' && normalized.account_id && typeof normalized.account_id !== 'string') {
        throw validationError(`Row ${index + 1} has an invalid account reference.`, 'account_id');
      }
      normalizedRows.push({ rowNumber: index + 1, data: normalized });
    } catch (error) {
      errors.push(...rowErrors(index + 1, error));
    }
  });

  const existing = await findExisting(sql, workspaceId, input.resource, normalizedRows.map(item => item.data));
  const seen = new Map();
  const readyRows = [];
  normalizedRows.forEach(item => {
    const duplicateReasons = duplicateKeys(input.resource, item.data)
      .filter(key => existing.has(key) || seen.has(key));
    if (duplicateReasons.length > 0) {
      errors.push({
        row: item.rowNumber,
        field: 'duplicate',
        message: `Duplicate ${input.resource.slice(0, -1)} detected (${duplicateReasons.join(', ')}).`,
      });
    } else {
      readyRows.push(item);
    }
    duplicateKeys(input.resource, item.data).forEach(key => seen.set(key, item.rowNumber));
  });

  if (input.resource === 'contacts') {
    const accountIds = [...new Set(readyRows.map(item => item.data.account_id).filter(Boolean))];
    if (accountIds.length > 0) {
      const accounts = await sql`
        SELECT id FROM accounts WHERE workspace_id = ${workspaceId} AND id = ANY(${accountIds}::uuid[])
      `;
      const validIds = new Set(accounts.map(account => account.id));
      readyRows.forEach(item => {
        if (item.data.account_id && !validIds.has(item.data.account_id)) {
          errors.push({ row: item.rowNumber, field: 'account_id', message: 'Account does not exist in this workspace.' });
        }
      });
    }
  }

  return { totalRows: input.rows.length, rows: readyRows.map(item => item.data), errors };
}

function mapImportRow(row, mapping) {
  const result = { ...row };
  Object.entries(mapping || {}).forEach(([target, source]) => {
    if (typeof source === 'string' && source in row) result[target] = row[source];
  });
  return result;
}

async function findExisting(sql, workspaceId, resource, rows) {
  const allKeys = [...new Set(rows.flatMap(row => duplicateKeys(resource, row)))];
  if (allKeys.length === 0) return new Map();
  const values = rows;
  const emailValues = values.map(row => row.normalized_email).filter(Boolean);
  const phoneValues = values.map(row => row.normalized_phone).filter(Boolean);
  const domainValues = values.map(row => row.normalized_domain).filter(Boolean);
  const nameValues = values.map(row => resource === 'accounts' ? row.normalized_name : normalizeName(row.name)).filter(Boolean);
  const rowsFound = await lookupExisting(sql, workspaceId, resource, emailValues, phoneValues, domainValues, nameValues);
  const result = new Map();
  rowsFound.forEach(row => duplicateKeys(resource, row).forEach(key => result.set(key, row)));
  return result;
}

async function lookupExisting(sql, workspaceId, resource, emails, phones, domains, names) {
  if (resource === 'accounts') {
    return sql`
      SELECT id, name, normalized_name, normalized_domain
      FROM accounts
      WHERE workspace_id = ${workspaceId}
        AND (normalized_name = ANY(${names.length ? names : ['__none__']}::text[])
          OR normalized_domain = ANY(${domains.length ? domains : ['__none__']}::text[]))
    `;
  }
  const table = resource;
  return sql`
    SELECT id, name, normalized_email, normalized_phone
    FROM ${sql.unsafe(table)}
    WHERE workspace_id = ${workspaceId}
      AND (normalized_email = ANY(${emails.length ? emails : ['__none__']}::text[])
        OR normalized_phone = ANY(${phones.length ? phones : ['__none__']}::text[]))
  `;
}

function duplicateKeys(resource, row) {
  if (!row) return [];
  if (resource === 'accounts') {
    return [
      row.normalized_name && `name:${row.normalized_name}`,
      row.normalized_domain && `domain:${row.normalized_domain}`,
    ].filter(Boolean);
  }
  return [
    row.normalized_email && `email:${row.normalized_email}`,
    row.normalized_phone && `phone:${row.normalized_phone}`,
  ].filter(Boolean);
}

function buildInsertQuery(sql, resource, workspaceId, userId, row) {
  if (resource === 'leads') {
    return sql`
      INSERT INTO leads (
        workspace_id, user_id, name, company, email, phone, normalized_email, normalized_phone,
        source, stage, notes, reminders, quote_items, won_at, lost_at
      ) VALUES (
        ${workspaceId}, ${userId}, ${row.name}, ${row.company ?? null}, ${row.email}, ${row.phone ?? null},
        ${row.normalized_email}, ${row.normalized_phone}, ${row.source ?? null}, ${row.stage},
        ${JSON.stringify(row.notes || [])}::jsonb, ${JSON.stringify(row.reminders || [])}::jsonb,
        ${JSON.stringify(row.quote_items || [])}::jsonb,
        ${row.stage === 'closed-won' ? new Date().toISOString() : null},
        ${row.stage === 'closed-lost' ? new Date().toISOString() : null}
      ) RETURNING id
    `;
  }
  if (resource === 'accounts') {
    return sql`
      INSERT INTO accounts (
        workspace_id, owner_user_id, created_by, updated_by, name, normalized_name,
        domain, normalized_domain, phone, normalized_phone, website, industry
      ) VALUES (
        ${workspaceId}, ${row.owner_user_id || userId}, ${userId}, ${userId}, ${row.name}, ${row.normalized_name},
        ${row.domain ?? null}, ${row.normalized_domain}, ${row.phone ?? null}, ${row.normalized_phone},
        ${row.website ?? null}, ${row.industry ?? null}
      ) RETURNING id
    `;
  }
  if (resource === 'contacts') {
    return sql`
      INSERT INTO contacts (
        workspace_id, account_id, owner_user_id, created_by, updated_by, name, title, email,
        normalized_email, phone, normalized_phone
      ) VALUES (
        ${workspaceId}, ${row.account_id ?? null}, ${row.owner_user_id || userId}, ${userId}, ${userId},
        ${row.name}, ${row.title ?? null}, ${row.email ?? null}, ${row.normalized_email},
        ${row.phone ?? null}, ${row.normalized_phone}
      ) RETURNING id
    `;
  }
  return sql`
    INSERT INTO customers (
      workspace_id, user_id, name, company, email, phone, normalized_email, normalized_phone
    ) VALUES (
      ${workspaceId}, ${userId}, ${row.name}, ${row.company ?? null}, ${row.email}, ${row.phone ?? null},
      ${row.normalized_email}, ${row.normalized_phone}
    ) RETURNING id
  `;
}

function formatImportResult(input, plan, mode) {
  return {
    mode,
    resource: input.resource,
    summary: summarize(plan),
    rows: plan.rows,
    errors: plan.errors,
    error_file: errorCsv(plan.errors),
  };
}

function summarize(plan) {
  return { total: plan.totalRows ?? plan.rows.length + plan.errors.length, ready: plan.rows.length, errors: plan.errors.length };
}

function errorCsv(errors) {
  if (!errors.length) return '';
  return ['row,field,message', ...errors.map(error => [error.row, error.field, error.message].map(csvCell).join(','))].join('\n');
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function rowErrors(row, error) {
  if (error?.details?.length) return error.details.map(detail => ({ row, field: detail.field, message: detail.message }));
  return [{ row, field: 'row', message: error?.message || 'The row is invalid.' }];
}

function validationError(message, field = 'row') {
  const error = new HttpError(400, 'validation_error', message, [{ field, message }]);
  return error;
}
