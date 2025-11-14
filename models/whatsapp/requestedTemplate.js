const mongoose = require("mongoose");

const requestedTemplateSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      ref: "Client",
      required: [true, "Client ID is required"],
    },
    requestClientId: {
      type: String,
      ref: "Client",
      required: [true, "Request client ID is required"],
    },
    templateBody: {
      type: String,
      required: [true, "Template body is required"],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("RequestedTemplate", requestedTemplateSchema);

