const EMAIL_MENTION = /(^|[\s(])@([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;

export async function createNotification(sql, {
  workspaceId,
  recipientUserId,
  type,
  title,
  body = null,
  entityType = null,
  entityId = null,
  dedupeKey = null,
  actionUrl = null,
  metadata = {},
}) {
  if (!recipientUserId) return null;
  const rows = await sql`
    INSERT INTO notifications (
      workspace_id, recipient_user_id, type, title, body, entity_type, entity_id,
      dedupe_key, action_url, metadata
    ) VALUES (
      ${workspaceId}, ${recipientUserId}, ${type}, ${title}, ${body}, ${entityType},
      ${entityId}, ${dedupeKey}, ${actionUrl}, ${JSON.stringify(metadata)}::jsonb
    )
    ON CONFLICT (workspace_id, recipient_user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
    DO UPDATE SET
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      action_url = EXCLUDED.action_url,
      metadata = EXCLUDED.metadata,
      status = CASE WHEN notifications.status = 'dismissed' THEN 'dismissed' ELSE 'unread' END,
      read_at = CASE WHEN notifications.status = 'dismissed' THEN notifications.read_at ELSE NULL END
    RETURNING *
  `;
  return rows[0] || null;
}

export async function notifyAssignment(sql, {
  workspaceId,
  actorUserId,
  recipientUserId,
  resource,
  entityId,
  title,
}) {
  if (!recipientUserId || recipientUserId === actorUserId) return null;
  return createNotification(sql, {
    workspaceId,
    recipientUserId,
    type: 'assignment',
    title: title || `A ${singular(resource)} was assigned to you`,
    body: 'Open CRM Pro to review the assignment.',
    entityType: singular(resource),
    entityId,
    dedupeKey: `assignment:${resource}:${entityId}:${recipientUserId}`,
    actionUrl: resource === 'activities' ? '/my-day' : `/${resource}`,
  });
}

export async function notifyMentions(sql, {
  workspaceId,
  actorUserId,
  text,
  entityType,
  entityId,
  actionUrl,
}) {
  const emails = extractMentionedEmails(text);
  if (!emails.length) return [];
  const members = await sql`
    SELECT user_id, email
    FROM workspace_members
    WHERE workspace_id = ${workspaceId}
      AND lower(email) = ANY(${emails}::text[])
  `;
  return Promise.all(members
    .filter(member => member.user_id !== actorUserId)
    .map(member => createNotification(sql, {
      workspaceId,
      recipientUserId: member.user_id,
      type: 'mention',
      title: 'You were mentioned in CRM Pro',
      body: String(text).slice(0, 1_000),
      entityType,
      entityId,
      dedupeKey: `mention:${entityType}:${entityId}:${member.user_id}`,
      actionUrl,
    })));
}

export async function materializeOverdueNotifications(sql, workspaceId, recipientUserId) {
  await sql`
    INSERT INTO notifications (
      workspace_id, recipient_user_id, type, title, body, entity_type, entity_id,
      dedupe_key, action_url, metadata
    )
    SELECT a.workspace_id, a.owner_user_id, 'overdue_activity', 'Activity overdue',
      left(COALESCE(a.subject, a.message, 'An activity needs attention'), 1000),
      'activity', a.id, concat('overdue:activity:', a.id::text), '/my-day',
      jsonb_build_object('due_at', a.due_at)
    FROM activities a
    WHERE a.workspace_id = ${workspaceId}
      AND a.owner_user_id = ${recipientUserId}
      AND a.completed_at IS NULL
      AND a.due_at < NOW()
    ON CONFLICT (workspace_id, recipient_user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
    DO NOTHING
  `;
}

function extractMentionedEmails(value) {
  const emails = new Set();
  for (const match of String(value || '').matchAll(EMAIL_MENTION)) emails.add(match[2].toLowerCase());
  return [...emails];
}

function singular(resource) {
  return resource.endsWith('ies')
    ? `${resource.slice(0, -3)}y`
    : resource.endsWith('s') ? resource.slice(0, -1) : resource;
}
