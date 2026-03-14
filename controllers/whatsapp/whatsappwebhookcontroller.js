const crypto = require("crypto");
const Message = require("../../models/whatsapp/message");
const Template = require("../../models/whatsapp/template");
const { getIO } = require("../../socket");
require("dotenv").config();

const WHATSAPP_VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || "naveendangwal";

/**
 * Test endpoint to verify webhook is accessible
 */
const testWebhook = (req, res) => {
  res.status(200).json({
    success: true,
    message: "Webhook endpoint is working",
    timestamp: new Date().toISOString(),
    verifyToken: WHATSAPP_VERIFY_TOKEN ? "Set" : "Not set",
  });
};

/**
 * Webhook verification endpoint - WhatsApp calls this to verify your webhook
 */
const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Forbidden");
  }
};

/**
 * Webhook endpoint to receive incoming messages from WhatsApp
 */
const receiveMessage = async (req, res) => {
  try {
    const body = req.body;

    if (!body) {
      return res.status(400).send("No body received");
    }

    // Check if this is a webhook verification
    if (body.object === "whatsapp_business_account") {
      if (body.entry && body.entry.length > 0) {
        const entry = body.entry[0];

        if (entry.changes && entry.changes.length > 0) {
          // Log all changes for full visibility
          try {
            entry.changes.forEach((chg, idx) => {
              console.log(`Webhook change[${idx}]:`, JSON.stringify(chg, null, 2));
            });
          } catch (_) {}

          const change = entry.changes[0];

          // Handle different types of changes
          if (change.field === "messages") {
            if (
              change.value &&
              change.value.messages &&
              change.value.messages.length > 0
            ) {
              const message = change.value.messages[0];
              const from = message.from;
              // Remove + prefix to match sent messages format
              const waIDNormalized = from?.startsWith("+") ? from.substring(1) : from;
              const type = message.type;

              // Better debugging for non-text types
              try {
                console.log("Incoming message:", {
                  from,
                  type,
                  text: message.text?.body,
                });
                if (type !== "text") {
                  console.log(
                    "Incoming message raw:",
                    JSON.stringify(message, null, 2)
                  );
                }
              } catch (e) {
                // no-op
              }

              // Normalize stored type and extract human-readable text
              let storedType = "text";
              let extractedText = message.text?.body;

              if (type === "button") {
                // Template quick replies often arrive as type 'button'
                storedType = "interactive";
                extractedText = message.button?.text || extractedText;
              } else if (type === "interactive") {
                storedType = "interactive";
                const interactiveType = message.interactive?.type;
                if (interactiveType === "button_reply") {
                  extractedText =
                    message.interactive?.button_reply?.title ||
                    message.interactive?.button_reply?.id ||
                    extractedText;
                } else if (interactiveType === "list_reply") {
                  extractedText =
                    message.interactive?.list_reply?.title ||
                    message.interactive?.list_reply?.id ||
                    extractedText;
                }
              } else if (
                type === "image" ||
                type === "document" ||
                type === "audio" ||
                type === "video"
              ) {
                storedType = "media";
              } else {
                storedType = type || "text";
              }

              // Persist incoming message for history
              try {
                await Message.create({
                  waID: waIDNormalized,
                  direction: "received",
                  type: storedType,
                  text: extractedText || undefined,
                  mediaType: message.image
                    ? "image"
                    : message.document
                    ? "document"
                    : message.audio
                    ? "audio"
                    : message.video
                    ? "video"
                    : undefined,
                  mediaUrl:
                    message.image?.link ||
                    message.document?.link ||
                    message.audio?.link ||
                    message.video?.link,
                  messageId: message.id,
                  status: "received",
                  timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
                });
                
                // emit realtime update to waID room
                const io = getIO();
                if (io) {
                  // Emit to room using normalized waID (without +)
                  io.to(waIDNormalized).emit("message", {
                    waID: waIDNormalized,
                    direction: "received",
                    type: storedType,
                    text: extractedText || undefined,
                    timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
                  });
                }
              } catch (persistErr) {
                console.error(
                  "Failed to persist incoming message:",
                  persistErr.message
                );
              }
            } else {
              // No messages in payload
            }
          } else if (change.field === "calls") {
            if (change.value && Array.isArray(change.value.calls)) {
              change.value.calls.forEach((call, idx) => {
                try {
                  const normalizedFrom = call.from?.startsWith("+")
                    ? call.from
                    : call.from
                    ? `+${call.from}`
                    : undefined;
                  const normalizedTo = call.to?.startsWith("+")
                    ? call.to
                    : call.to
                    ? `+${call.to}`
                    : undefined;
                  console.log("Incoming WhatsApp call:", {
                    index: idx,
                    callId: call.id,
                    from: normalizedFrom,
                    to: normalizedTo,
                    direction: call.direction,
                    status: call.event || call.state,
                    callType: call.call_type || call.type,
                    timestamp: call.timestamp,
                    duration: call.duration,
                    waId: call.wa_id || call.from,
                  });
                } catch (callLogErr) {
                  console.error("Failed to log call payload:", callLogErr.message);
                }
              });
            }
          } else if (change.field === "statuses") {
            // Handle message status updates (delivered, read, failed)
            if (
              change.value &&
              change.value.statuses &&
              change.value.statuses.length > 0
            ) {
              const status = change.value.statuses[0];
              const messageId = status.id;
              const recipientId = status.recipient_id;
              const statusValue = status.status; // sent, delivered, read, failed
              
              console.log('Message status update:', { messageId, recipientId, status: statusValue });
              
              // Update message status in database
              try {
                const updatedMessage = await Message.findOneAndUpdate(
                  { messageId: messageId },
                  { status: statusValue },
                  { new: true }
                );
                
                if (updatedMessage) {
                  console.log(`Message ${messageId} status updated to ${statusValue}`);
                  
                  // Emit status update via Socket.io
                  const io = getIO();
                  if (io) {
                    const normalizedWaID = recipientId?.startsWith('+') ? recipientId.substring(1) : recipientId;
                    io.to(normalizedWaID).emit('messageStatus', {
                      messageId: messageId,
                      status: statusValue,
                      waID: normalizedWaID
                    });
                  }
                }
              } catch (statusErr) {
                console.error('Failed to update message status:', statusErr.message);
              }
            }
          } else if (change.field === "message_template_status_update") {
            try {
              const evt = change.value;
              // Example value shape:
              // {
              //   "event": "APPROVED" | "REJECTED" | "PENDING",
              //   "message_template_id": "1234567890",
              //   "message_template_name": "order_update_v1",
              //   "language": "en",
              //   "reason": "..." // when REJECTED
              // }
              const metaId = evt.message_template_id;
              const name = evt.message_template_name;
              const language = evt.language;
              const event = evt.event;

              // Find by metaTemplateId first, fallback to name+language
              const query = metaId
                ? { metaTemplateId: metaId }
                : (name && language ? { name, language } : null);

              if (query) {
                const update = { status: (event || '').toLowerCase() };
                if (evt.reason) {
                  update.lastError = { reason: evt.reason, raw: evt };
                } else {
                  update.lastError = undefined;
                }
                await Template.findOneAndUpdate(query, update, { new: true }).lean();
              }
            } catch (e) {
              console.error('Failed to update template status from webhook:', e.message);
            }
          } else {
            // Other change field; handle here if needed
          }
        } else {
          // No changes in entry
        }
      } else {
        // No entries in webhook
      }

      res.status(200).send("OK");
    } else {
      res.status(404).send("Not Found");
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error");
  }
};

module.exports = {
  testWebhook,
  verifyWebhook,
  receiveMessage,
};
