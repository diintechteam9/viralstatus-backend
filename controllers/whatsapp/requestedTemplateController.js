const RequestedTemplate = require("../../models/whatsapp/requestedTemplate");

/**
 * Create a new requested template entry
 */
const createRequestedTemplate = async (req, res) => {
  try {
    const { clientId, requestClientId, templateBody } = req.body;

    if (!clientId || !requestClientId || !templateBody) {
      return res.status(400).json({
        success: false,
        message: "clientId, requestClientId and templateBody are required",
      });
    }

    const requestedTemplate = await RequestedTemplate.create({
      clientId,
      requestClientId,
      templateBody,
    });

    return res.status(201).json({
      success: true,
      data: requestedTemplate,
    });
  } catch (error) {
    console.error("Error creating requested template:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create requested template",
    });
  }
};

/**
 * Get requested templates, optionally filtered by clientId/requestClientId
 */
const getRequestedTemplates = async (req, res) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "clientId query parameter is required",
      });
    }

    const requestedTemplates = await RequestedTemplate.find({ clientId })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: requestedTemplates,
    });
  } catch (error) {
    console.error("Error fetching requested templates:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch requested templates",
    });
  }
};

module.exports = {
  createRequestedTemplate,
  getRequestedTemplates,
};

