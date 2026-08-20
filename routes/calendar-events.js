import { getCalendarConnection, getValidCalendarAccess } from '../server/calendar-auth.js';
import { googleEventId } from '../server/calendar-providers/google.js';
import { getDb } from '../server/db.js';
import { HttpError, json, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { canAccessAllRecords } from '../server/authorization.js';

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId }) {
    const action = req.body?.action;
    const meetingId = req.body?.meeting_id;
    if (!['sync', 'delete'].includes(action)) throw new HttpError(400, 'validation_error', 'Calendar action must be sync or delete.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meetingId || '')) {
      throw new HttpError(400, 'invalid_id', 'A valid meeting ID is required.');
    }

    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const accessAll = canAccessAllRecords(workspace);
    const meetingRows = await sql`
      SELECT id, workspace_id, user_id, lead_id, title, date_time, end_time, notes, integration_id,
             provider, external_event_id, meeting_url, sync_status, sync_error, last_synced_at
      FROM meetings WHERE id = ${meetingId} AND workspace_id = ${workspace.id}
        AND (${accessAll} OR user_id = ${userId})
    `;
    const meeting = meetingRows[0];
    if (!meeting) throw new HttpError(404, 'not_found', 'Meeting not found.');
    const connection = await getCalendarConnection(sql, workspace.id, userId);
    if (meeting.integration_id && meeting.integration_id !== connection.id) {
      throw new HttpError(409, 'calendar_owner_mismatch', 'This meeting is synced through another team member’s calendar.');
    }

    try {
      const { provider, accessToken } = await getValidCalendarAccess(sql, connection);
      if (action === 'delete') {
        if (meeting.external_event_id) {
          await provider.deleteEvent({ accessToken, calendarId: connection.calendar_id || 'primary', eventId: meeting.external_event_id });
        }
        const deleted = await sql`
          UPDATE meetings SET provider = 'google', integration_id = ${connection.id},
            external_event_id = COALESCE(external_event_id, ${googleEventId(meeting.id)}),
            meeting_url = NULL, sync_status = 'deleted', sync_error = NULL,
            last_synced_at = NOW(), updated_at = NOW()
          WHERE id = ${meeting.id} AND workspace_id = ${workspace.id}
          RETURNING *
        `;
        await upsertMeetingTimeline(sql, workspace.id, userId, deleted[0]);
        return json(res, 200, { data: deleted[0] });
      }

      const event = await provider.upsertEvent({
        accessToken,
        calendarId: connection.calendar_id || 'primary',
        meeting,
        timezone: workspace.timezone,
        createMeetingUrl: req.body?.create_meeting_url !== false,
      });
      const meetingUrl = event.hangoutLink
        || event.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri
        || event.htmlLink
        || null;
      const synced = await sql`
        UPDATE meetings SET provider = 'google', integration_id = ${connection.id},
          external_event_id = ${event.id || googleEventId(meeting.id)}, meeting_url = ${meetingUrl},
          sync_status = 'synced', sync_error = NULL, last_synced_at = NOW(), updated_at = NOW()
        WHERE id = ${meeting.id} AND workspace_id = ${workspace.id}
        RETURNING *
      `;
      await sql`
        UPDATE communication_integrations SET last_synced_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE id = ${connection.id} AND workspace_id = ${workspace.id}
      `;
      await upsertMeetingTimeline(sql, workspace.id, userId, synced[0]);
      return json(res, 200, { data: synced[0] });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const reason = providerErrorMessage(error);
      await sql.transaction([
        sql`
          UPDATE meetings SET sync_status = 'failed', sync_error = ${reason}, updated_at = NOW()
          WHERE id = ${meeting.id} AND workspace_id = ${workspace.id}
        `,
        sql`
          UPDATE communication_integrations SET status = CASE WHEN ${error.status === 401} THEN 'error' ELSE status END,
            last_error = ${reason}, updated_at = NOW()
          WHERE id = ${connection.id} AND workspace_id = ${workspace.id}
        `,
        sql`
          INSERT INTO notifications (workspace_id, recipient_user_id, type, title, body, entity_type, entity_id)
          VALUES (${workspace.id}, ${userId}, 'failed_sync', 'Calendar sync failed',
            ${`${meeting.title}: ${reason}`.slice(0, 1_000)}, 'meeting', ${meeting.id})
        `,
      ]);
      throw new HttpError(502, 'calendar_sync_failed', 'Google Calendar could not be updated. The meeting remains available for retry.');
    }
  },
});

function providerErrorMessage(error) {
  const message = error instanceof Error ? error.message : 'Unknown Google Calendar error.';
  return message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]').slice(0, 1_000);
}

async function upsertMeetingTimeline(sql, workspaceId, actorUserId, meeting) {
  const deleted = meeting.sync_status === 'deleted';
  const message = deleted
    ? `Removed from Google Calendar: ${meeting.title}`
    : `Synced to Google Calendar${meeting.meeting_url ? `: ${meeting.meeting_url}` : ''}`;
  await sql`
    INSERT INTO activities (
      workspace_id, user_id, lead_id, type, subject, description, message, due_at,
      completed_at, priority, owner_user_id, outcome, created_by, timestamp,
      created_at, updated_at, source_type, source_id
    ) VALUES (
      ${workspaceId}, ${meeting.user_id || actorUserId}, ${meeting.lead_id}, 'meeting',
      ${meeting.title}, ${meeting.notes || message}, ${message}, ${meeting.date_time},
      ${deleted ? new Date().toISOString() : null}, 'normal', ${meeting.user_id || actorUserId},
      ${deleted ? 'Deleted from Google Calendar' : 'Synced to Google Calendar'},
      ${actorUserId}, NOW(), NOW(), NOW(), 'calendar_meeting', ${meeting.id}
    )
    ON CONFLICT (workspace_id, source_type, source_id)
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      lead_id = EXCLUDED.lead_id,
      subject = EXCLUDED.subject,
      description = EXCLUDED.description,
      message = EXCLUDED.message,
      due_at = EXCLUDED.due_at,
      completed_at = EXCLUDED.completed_at,
      outcome = EXCLUDED.outcome,
      updated_at = NOW()
  `;
}
