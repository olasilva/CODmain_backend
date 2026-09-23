// src/controllers/sessionController.js
const supabaseService = require('../services/supabaseService');
const { sendMail } = require('../services/emailService');
const notificationController = require('./notificationController');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function fmtDate(d) {
  return new Date(d).toLocaleString('en-NG', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapSession(s) {
  return {
    _id: s.id,
    id: s.id,
    title: s.title,
    description: s.description,
    classes: s.classes || [],
    recipients: s.recipients || [],
    host: { name: s.host_name || 'Your instructor' },
    meetingLink: s.meeting_link,
    meetingId: s.meeting_id,
    passcode: s.passcode,
    startTime: s.start_time,
    endTime: s.end_time,
    recordingLink: s.recording_link,
    status: s.status,
    createdAt: s.created_at,
  };
}

// ---------- STAFF: create ----------
exports.createSession = async (req, res) => {
  try {
    const {
      title,
      description,
      classes,
      recipients,
      meetingLink,
      meetingId,
      passcode,
      startTime,
      endTime,
      notifyStudents = true,
    } = req.body;

    if (!title || !classes?.length || !meetingLink || !startTime || !endTime) {
      return res.status(400).json({
        error: 'title, classes, meetingLink, startTime, endTime are required',
      });
    }
    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ error: 'endTime must be after startTime' });
    }

    const hostId = String(req.user.id || req.user._id || '');
    const hostName =
      req.user.name || req.user.full_name || req.user.email || 'Your instructor';

    const { data: row, error: insertError } = await supabaseService.client
      .from('online_sessions')
      .insert([
        {
          title,
          description: description || '',
          classes: classes || [],
          recipients: recipients || [],
          host_id: hostId,
          host_name: hostName,
          meeting_link: meetingLink,
          meeting_id: meetingId || '',
          passcode: passcode || '',
          start_time: startTime,
          end_time: endTime,
          status: 'scheduled',
        },
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    let notified = 0;

    if (notifyStudents && recipients?.length) {
      try {
        const portalNotifications = recipients
          .filter((r) => r.id)
          .map((r) => ({
            studentId: r.id,
            title: `New online class: ${title}`,
            message: `${hostName} scheduled a session for ${fmtDate(
              startTime
            )}. Join from your Sessions page.`,
            type: 'online_session',
            link: '/student/sessions',
          }));

        if (portalNotifications.length) {
          const { succeeded, failed } = await notificationController.pushMany(
            portalNotifications
          );
          console.log(
            `📢 Portal notifications: ${succeeded} sent, ${failed} failed`
          );
        }
      } catch (notifErr) {
        console.error('Portal notification failed:', notifErr.message);
      }

      const buildHtml = (student) => `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#1A73E8;margin:0 0 12px;">New Online Class Scheduled</h2>
          <p style="color:#334155;margin:0 0 16px;">Hello ${student.name || 'Student'},</p>
          <p style="color:#334155;margin:0 0 16px;">
            <strong>${hostName}</strong> has scheduled a live online session for your class.
          </p>
          <div style="background:#F5F9FF;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:16px 0;">
            <p style="margin:0 0 8px;"><strong>${title}</strong></p>
            ${description ? `<p style="margin:0 0 8px;color:#475569;">${description}</p>` : ''}
            <p style="margin:0;color:#475569;">🕒 ${fmtDate(startTime)} — ${fmtDate(endTime)}</p>
            ${meetingId ? `<p style="margin:6px 0 0;color:#475569;">Meeting ID: <strong>${meetingId}</strong></p>` : ''}
            ${passcode ? `<p style="margin:6px 0 0;color:#475569;">Passcode: <strong>${passcode}</strong></p>` : ''}
          </div>
          <a href="${meetingLink}" style="display:inline-block;background:#1A73E8;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;">
            Join Online Class
          </a>
          <p style="color:#94a3b8;font-size:12px;margin-top:20px;">
            Or open your dashboard:
            <a href="${FRONTEND_URL}/student/sessions" style="color:#1A73E8;">${FRONTEND_URL}/student/sessions</a>
          </p>
          <p style="color:#94a3b8;font-size:12px;margin-top:8px;">— Clan of David Art and Music Academy</p>
        </div>
      `;

      const emailResults = await Promise.allSettled(
        recipients
          .filter((r) => r.email)
          .map((r) =>
            sendMail({
              to: r.email,
              subject: `📚 Online Class: ${title}`,
              text: `${hostName} scheduled "${title}" on ${fmtDate(startTime)}.\nJoin: ${meetingLink}`,
              html: buildHtml(r),
            })
          )
      );

      notified = emailResults.filter((r) => r.status === 'fulfilled').length;
    }

    return res
      .status(201)
      .json({ success: true, session: mapSession(row), notified });
  } catch (err) {
    console.error('createSession error:', err);
    return res
      .status(500)
      .json({ error: err.message || 'Failed to create session' });
  }
};

// ---------- STAFF: list own ----------
exports.getStaffSessions = async (req, res) => {
  try {
    const hostId = String(req.user.id || req.user._id || '');

    const { data, error } = await supabaseService.client
      .from('online_sessions')
      .select('*')
      .eq('host_id', hostId)
      .order('start_time', { ascending: false });

    if (error) throw error;

    return res.json({ sessions: (data || []).map(mapSession) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ---------- STAFF: update ----------
exports.updateSession = async (req, res) => {
  try {
    const hostId = String(req.user.id || req.user._id || '');
    const { id } = req.params;
    const b = req.body;

    const patch = { updated_at: new Date().toISOString() };
    if (b.title !== undefined) patch.title = b.title;
    if (b.description !== undefined) patch.description = b.description;
    if (b.meetingLink !== undefined) patch.meeting_link = b.meetingLink;
    if (b.meetingId !== undefined) patch.meeting_id = b.meetingId;
    if (b.passcode !== undefined) patch.passcode = b.passcode;
    if (b.startTime !== undefined) patch.start_time = b.startTime;
    if (b.endTime !== undefined) patch.end_time = b.endTime;
    if (b.status !== undefined) patch.status = b.status;
    if (b.recordingLink !== undefined) patch.recording_link = b.recordingLink;
    if (b.classes !== undefined) patch.classes = b.classes;

    const { data, error } = await supabaseService.client
      .from('online_sessions')
      .update(patch)
      .eq('id', id)
      .eq('host_id', hostId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found' });

    return res.json({ success: true, session: mapSession(data) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ---------- STAFF: delete ----------
exports.deleteSession = async (req, res) => {
  try {
    const hostId = String(req.user.id || req.user._id || '');
    const { id } = req.params;

    const { error } = await supabaseService.client
      .from('online_sessions')
      .delete()
      .eq('id', id)
      .eq('host_id', hostId);

    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ---------- STUDENT: list sessions they were invited to ----------
exports.getStudentSessions = async (req, res) => {
  try {
    const email = req.user.email;
    if (!email) return res.status(400).json({ error: 'No email on account' });

    const { data, error } = await supabaseService.client
      .from('online_sessions')
      .select('*')
      .neq('status', 'cancelled')
      .contains('recipients', [{ email }]);

    if (error) throw error;

    const now = new Date();
    const mapped = (data || []).map(mapSession);

    const upcoming = mapped
      .filter((s) => new Date(s.startTime) >= now)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    const past = mapped
      .filter((s) => new Date(s.startTime) < now)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    return res.json({ upcoming, past });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};