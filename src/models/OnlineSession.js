// backend/src/models/OnlineSession.js
const mongoose = require("mongoose");

const onlineSessionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },

    // No ref to a Class model — store plain objects.
    // Example: [{ id: "piano-101", name: "Piano Beginners" }]
    classes: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
      },
    ],

    // Students this session is for. Backend stores them directly.
    // Example: [{ id: "u_123", name: "Ada", email: "ada@x.com" }]
    recipients: [
      {
        id: { type: String },
        name: { type: String },
        email: { type: String, required: true },
      },
    ],

    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    meetingLink: { type: String, required: true, trim: true },
    meetingId: { type: String, trim: true, default: "" },
    passcode: { type: String, trim: true, default: "" },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    recordingLink: { type: String, trim: true, default: "" },

    status: {
      type: String,
      enum: ["scheduled", "live", "completed", "cancelled"],
      default: "scheduled",
    },
  },
  { timestamps: true }
);

onlineSessionSchema.index({ startTime: 1 });
onlineSessionSchema.index({ "recipients.id": 1 });
onlineSessionSchema.index({ "recipients.email": 1 });

module.exports = mongoose.model("OnlineSession", onlineSessionSchema);