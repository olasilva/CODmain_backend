// backend/src/controllers/sessionController.js
const OnlineSession = require("../models/OnlineSession");
const Class = require("../models/Class");               // adjust if named differently
const User = require("../models/User");
const Notification = require("../models/Notification"); // only if you created it
const { sendMail } = require("../services/emailService"); // ✅ named import

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ---------- Helpers ----------
function fmtDate(d) {
  return new Date(d).toLocaleString("en-NG", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getStudentsForClasses(classIds) {
  // Assumes Class has `enrolledStudents` array of User ObjectIds.
  // Adjust field name if yours differs.
  const classes = await Class.find({ _id: { $in: classIds } })
    .populate("enrolledStudents", "name email")
    .lean();

  const map = new Map();
  for (const c of classes) {
    for (const s of c.enrolledStudents || []) {
      if (s?._id) map.set(String(s._id), s);
    }
  }
  return [...map.values()];
}

// ---------- STAFF: create ----------
exports.createSession = async (req, res) => {
  try {
    const {
      title,
      description,
      classIds,
      meetingLink,
      meetingId,
      passcode,
      startTime,
      endTime,
      notifyStudents = true,
    } = req.body;

    if (!title || !classIds?.length || !meetingLink || !startTime || !endTime) {
      return res.status(400).json({
        error: "title, classIds, meetingLink, startTime, endTime are required",
      });
    }
    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ error: "endTime must be after startTime" });
    }

    const session = await OnlineSession.create({
      title,
      description: description || "",
      classes: classIds,
      host: req.user.id || req.user._id,
      meetingLink,
      meetingId: meetingId || "",
      passcode: passcode || "",
      startTime,
      endTime,
    });

    let notified = 0;

    if (notifyStudents) {
      const students = await getStudentsForClasses(classIds);
      const host = await User.findById(session.host).select("name").lean();
      const hostName = host?.name || "Your instructor";

      // ---- Portal notifications ----
      try {
        const notifDocs = students.map((s) => ({
          user: s._id,
          type: "online_session",
          title: `New online class: ${title}`,
          message: `${hostName} scheduled a live session for ${fmtDate(startTime)}.`,
          link: "/student/sessions",
          meta: { sessionId: session._id },
        }));
        if (notifDocs.length) {
          await Notification.insertMany(notifDocs);
        }
      } catch (notifErr) {
        console.error("Notification insert failed:", notifErr.message);
      }

      // ---- Emails ----
      const emailHtml = (student) => `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
          <h2 style="color:#1A73E8;margin:0 0 12px;">New Online Class Scheduled</h2>
          <p style="color:#334155;margin:0 0 16px;">Hello ${student.name || "Student"},</p>
          <p style="color:#334155;margin:0 0 16px;">
            <strong>${hostName}</strong> has scheduled a live online session for your class.
          </p>
          <div style="background:#F5F9FF;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:16px 0;">
            <p style="margin:0 0 8px;"><strong>${title}</strong></p>
            ${description ? `<p style="margin:0 0 8px;color:#475569;">${description}</p>` : ""}
            <p style="margin:0;color:#475569;">🕒 ${fmtDate(startTime)} — ${fmtDate(endTime)}</p>
            ${meetingId ? `<p style="margin:6px 0 0;color:#475569;">Meeting ID: <strong>${meetingId}</strong></p>` : ""}
            ${passcode ? `<p style="margin:6px 0 0;color:#475569;">Passcode: <strong>${passcode}</strong></p>` : ""}
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

      // ✅ Use emailService.sendMail, not sendEmail
      await Promise.allSettled(
        students.map((s) =>
          sendMail({
            to: s.email,
            subject: `📚 Online Class: ${title}`,
            text: `${hostName} scheduled "${title}" on ${fmtDate(startTime)}.\nJoin: ${meetingLink}`,
            html: emailHtml(s),
          })
        )
      );

      session.notifiedStudents = students.map((s) => s._id);
      await session.save();
      notified = students.length;
    }

    return res.status(201).json({ success: true, session, notified });
  } catch (err) {
    console.error("createSession error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to create session" });
  }
};

// ---------- STAFF: list own ----------
exports.getStaffSessions = async (req, res) => {
  try {
    const sessions = await OnlineSession.find({
      host: req.user.id || req.user._id,
    })
      .populate("classes", "name")
      .sort({ startTime: -1 })
      .lean();
    return res.json({ sessions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ---------- STAFF: update ----------
exports.updateSession = async (req, res) => {
  try {
    const session = await OnlineSession.findOne({
      _id: req.params.id,
      host: req.user.id || req.user._id,
    });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const fields = [
      "title",
      "description",
      "meetingLink",
      "meetingId",
      "passcode",
      "startTime",
      "endTime",
      "status",
      "recordingLink",
      "classes",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) session[f] = req.body[f];
    }
    await session.save();
    return res.json({ success: true, session });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ---------- STAFF: delete ----------
exports.deleteSession = async (req, res) => {
  try {
    const session = await OnlineSession.findOneAndDelete({
      _id: req.params.id,
      host: req.user.id || req.user._id,
    });
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ---------- STUDENT: list for their classes ----------
exports.getStudentSessions = async (req, res) => {
  try {
    const studentId = req.user.id || req.user._id;

    const classes = await Class.find({ enrolledStudents: studentId })
      .select("_id")
      .lean();
    const classIds = classes.map((c) => c._id);

    const now = new Date();
    const sessions = await OnlineSession.find({
      classes: { $in: classIds },
      status: { $ne: "cancelled" },
    })
      .populate("host", "name")
      .populate("classes", "name")
      .sort({ startTime: 1 })
      .lean();

    const upcoming = sessions.filter((s) => new Date(s.startTime) >= now);
    const past = sessions
      .filter((s) => new Date(s.startTime) < now)
      .reverse();

    return res.json({ upcoming, past });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};