const express = require("express");
const {
  createRequestedTemplate,
  getRequestedTemplates,
} = require("../../controllers/whatsapp/requestedTemplateController");

const router = express.Router();

router.post("/", createRequestedTemplate);
router.get("/", getRequestedTemplates);

module.exports = router;

