const axios = require("axios");
require("dotenv").config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const Template = require('../../models/whatsapp/template');
const ApprovedTemplate = require('../../models/whatsapp/approvedTemplate');
const PendingTemplate = require('../../models/whatsapp/pendingTemplate');
const RejectedTemplate = require('../../models/whatsapp/rejectedTemplate');
const { submitTemplateToMeta } = require('../../services/metaTemplateService');

const mapMetaStatusToLocal = (status = "") => {
  const normalized = status.toString().toLowerCase();
  if (["approved", "rejected", "pending"].includes(normalized)) return normalized;
  if (
    ["submitted", "in_review", "under_review", "inappeal", "appeal", "pause", "paused"].includes(
      normalized
    )
  ) {
    return "pending";
  }
  return "pending";
};

/**
 * Fetch templates from Meta and sync into Mongo.
 * Returns the full list from Mongo after sync.
 */
const syncTemplatesWithMeta = async () => {
  const url = `https://graph.facebook.com/v18.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  // 1) Fetch from Meta
  let metaTemplates = [];
  try {
    const response = await axios.get(url, { headers });
    metaTemplates = response.data?.data || [];
  } catch (e) {
    // If Meta call fails, continue to return existing Mongo state
    console.error(
      "Meta fetch failed, returning existing ApprovedTemplates only:",
      e.response?.data || e.message
    );
  }

  // 2) Upsert into Mongo (only approved templates retained by this model)
  if (Array.isArray(metaTemplates) && metaTemplates.length > 0) {
    for (const tpl of metaTemplates) {
      const rawStatus = tpl.status || tpl.state || "approved";
      const normalizedStatus = mapMetaStatusToLocal(rawStatus);
      const metaTemplateId = tpl.id || tpl.message_template_id;

      // Keep Template collection in sync with Meta status
      const templateQuery = { name: tpl.name, language: tpl.language };
      const templateUpdate = {
        status: normalizedStatus,
        metaTemplateId,
        metaRaw: tpl,
        lastError: null,
      };
      const updatedTemplate = await Template.findOneAndUpdate(templateQuery, templateUpdate, {
        new: true,
        setDefaultsOnInsert: false,
      });

      // Store templates in their respective collections based on status
      const baseUpdate = {
        metaTemplateId,
        name: tpl.name,
        language: tpl.language,
        category: tpl.category,
        status: normalizedStatus,
        quality_score: tpl.quality_score || tpl.quality_score_category,
        components: tpl.components,
        metaRaw: tpl,
      };
      if (updatedTemplate?.clientId) {
        baseUpdate.clientId = updatedTemplate.clientId;
      }

      if (normalizedStatus === "approved") {
        const approvedQuery = { name: tpl.name, language: tpl.language };
        await ApprovedTemplate.findOneAndUpdate(approvedQuery, baseUpdate, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        });
        // Remove from pending/rejected if it was there
        await PendingTemplate.deleteOne({ name: tpl.name, language: tpl.language });
        await RejectedTemplate.deleteOne({ name: tpl.name, language: tpl.language });
      } else if (normalizedStatus === "pending") {
        const pendingQuery = { name: tpl.name, language: tpl.language };
        await PendingTemplate.findOneAndUpdate(pendingQuery, baseUpdate, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        });
        // Remove from approved/rejected if it was there
        await ApprovedTemplate.deleteOne({ name: tpl.name, language: tpl.language });
        await RejectedTemplate.deleteOne({ name: tpl.name, language: tpl.language });
      } else if (normalizedStatus === "rejected") {
        const rejectedQuery = { name: tpl.name, language: tpl.language };
        await RejectedTemplate.findOneAndUpdate(rejectedQuery, baseUpdate, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        });
        // Remove from approved/pending if it was there
        await ApprovedTemplate.deleteOne({ name: tpl.name, language: tpl.language });
        await PendingTemplate.deleteOne({ name: tpl.name, language: tpl.language });
      }
    }
  }

  // Note: Templates are now stored in separate collections based on status
  // This function syncs from Meta but doesn't return anything
  // Use getApprovedTemplates, getPendingTemplates, or getRejectedTemplates instead
};

const getTemplates = async (req, res) => {
  try {
    await syncTemplatesWithMeta();
    // After syncing, fetch approved templates (optionally filtered by clientId)
    const { clientId } = req.query;
    const query = clientId ? { clientId } : {};
    const docs = await ApprovedTemplate.find(query).sort({ updatedAt: -1 }).lean();
    return res
      .status(200)
      .json({ success: true, message: "Templates fetched successfully", templates: docs });
  } catch (error) {
    console.error("Error syncing templates:", error.response?.data || error.message || error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch templates",
        error: error.response?.data || error.message || "Unknown error",
      });
  }
};

/**
 * Create and submit a WhatsApp template: save to Mongo and POST to Meta
 */
const createTemplate = async (req, res) => {
  try {
    const {
      name,
      category,
      language,
      components,
      parameter_format,
      allow_category_change,
      clientId,
    } = req.body;

    if (!name || !category || !language || !Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing required fields: name, category, language, components[]' });
    }

    // Determine parameter format if not explicitly provided
    let resolvedParameterFormat = parameter_format;
    if (!resolvedParameterFormat) {
      const bodyComponent = Array.isArray(components) ? components.find(c => c?.type === 'BODY' && typeof c.text === 'string') : undefined;
      if (bodyComponent?.text?.includes('{{1}}')) {
        resolvedParameterFormat = 'POSITIONAL';
      } else if (bodyComponent?.text?.includes('{{name}}')) {
        resolvedParameterFormat = 'NAMED';
      }
    }

    // Save draft first
    const draft = await Template.create({
      name,
      category,
      language,
      components,
      parameter_format: resolvedParameterFormat,
      allow_category_change,
      status: 'submitted',
      clientId: clientId || null,
    });

    // Submit to Meta
    try {
      const metaResp = await submitTemplateToMeta({ name, category, language, components, parameter_format: resolvedParameterFormat, allow_category_change });

      // Meta can return an id or the full template; store raw
      draft.metaRaw = metaResp;
      // If Meta returns an id field
      if (metaResp?.id) draft.metaTemplateId = metaResp.id;
      draft.status = 'pending';
      await draft.save();

      // Also save to PendingTemplate collection immediately
      try {
        const pendingData = {
          metaTemplateId: draft.metaTemplateId,
          name: draft.name,
          language: draft.language,
          category: draft.category,
          status: 'pending',
          components: draft.components,
          metaRaw: draft.metaRaw,
        };
        if (draft.clientId) {
          pendingData.clientId = draft.clientId;
        }
        await PendingTemplate.findOneAndUpdate(
          { name: draft.name, language: draft.language },
          pendingData,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (pendingErr) {
        console.error('Error saving to PendingTemplate:', pendingErr);
        // Don't fail the request if this fails, just log it
      }

      return res.status(201).json({ success: true, message: 'Template submitted to Meta', template: draft });
    } catch (metaErr) {
      const metaData = metaErr.response?.data || { message: metaErr.message };
      draft.lastError = metaData;
      draft.status = 'failed';
      await draft.save();
      return res.status(502).json({ success: false, message: 'Meta submission failed', error: metaData, template: draft });
    }
  } catch (error) {
    console.error('Error creating template:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List templates from MongoDB with latest status
const listTemplates = async (req, res) => {
  try {
    const docs = await Template.find({}).sort({ updatedAt: -1 }).lean();
    res.status(200).json({ success: true, templates: docs });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to list templates' });
  }
};

// Get pending templates
const getPendingTemplates = async (req, res) => {
  try {
    // Sync with Meta first to get latest status
    try {
      await syncTemplatesWithMeta();
    } catch (syncError) {
      console.error("Error syncing templates with Meta (continuing with cached data):", syncError);
      // Continue with cached data if sync fails
    }

    const { clientId } = req.query;
    const query = clientId ? { clientId } : {};
    const docs = await PendingTemplate.find(query).sort({ updatedAt: -1 }).lean();
    return res.status(200).json({ 
      success: true, 
      message: "Pending templates fetched successfully", 
      templates: docs 
    });
  } catch (error) {
    console.error("Error fetching pending templates:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending templates",
      error: error.message || "Unknown error",
    });
  }
};

// Get rejected templates
const getRejectedTemplates = async (req, res) => {
  try {
    // Sync with Meta first to get latest status
    try {
      await syncTemplatesWithMeta();
    } catch (syncError) {
      console.error("Error syncing templates with Meta (continuing with cached data):", syncError);
      // Continue with cached data if sync fails
    }

    const { clientId } = req.query;
    const query = clientId ? { clientId } : {};
    const docs = await RejectedTemplate.find(query).sort({ updatedAt: -1 }).lean();
    return res.status(200).json({ 
      success: true, 
      message: "Rejected templates fetched successfully", 
      templates: docs 
    });
  } catch (error) {
    console.error("Error fetching rejected templates:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch rejected templates",
      error: error.message || "Unknown error",
    });
  }
};

// Get approved templates (with optional clientId filter)
const getApprovedTemplates = async (req, res) => {
  try {
    // Sync with Meta first to get latest status
    try {
      await syncTemplatesWithMeta();
    } catch (syncError) {
      console.error("Error syncing templates with Meta (continuing with cached data):", syncError);
      // Continue with cached data if sync fails
    }

    const { clientId } = req.query;
    const query = clientId ? { clientId } : {};
    const docs = await ApprovedTemplate.find(query).sort({ updatedAt: -1 }).lean();
    return res.status(200).json({ 
      success: true, 
      message: "Approved templates fetched successfully", 
      templates: docs 
    });
  } catch (error) {
    console.error("Error fetching approved templates:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch approved templates",
      error: error.message || "Unknown error",
    });
  }
};

// Check if template name already exists (across all clients)
// Meta/Facebook doesn't allow duplicate template names globally
const checkTemplateNameExists = async (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Template name is required",
        exists: false
      });
    }

    // Check in ApprovedTemplate collection (across all clients)
    const approvedTemplate = await ApprovedTemplate.findOne({ 
      name: name.trim() 
    }).lean();

    // Also check in PendingTemplate and RejectedTemplate to be thorough
    // since Meta might reject duplicates even if pending/rejected
    const pendingTemplate = await PendingTemplate.findOne({ 
      name: name.trim() 
    }).lean();
    
    const rejectedTemplate = await RejectedTemplate.findOne({ 
      name: name.trim() 
    }).lean();

    // Also check in main Template collection
    const template = await Template.findOne({ 
      name: name.trim() 
    }).lean();

    const exists = !!(approvedTemplate || pendingTemplate || rejectedTemplate || template);

    return res.status(200).json({
      success: true,
      exists: exists,
      message: exists 
        ? "Template name already exists. Please choose a different name." 
        : "Template name is available"
    });
  } catch (error) {
    console.error("Error checking template name:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check template name",
      error: error.message || "Unknown error",
      exists: false // Return false on error to not block user
    });
  }
};

module.exports = { 
  getTemplates, 
  createTemplate, 
  listTemplates, 
  syncTemplatesWithMeta,
  getPendingTemplates,
  getRejectedTemplates,
  getApprovedTemplates,
  checkTemplateNameExists
};
