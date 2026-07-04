const express = require("express");
const { 
  registerAdmin, 
  loginAdmin, 
  getClients, 
  getClientById, 
  registerclient, 
  deleteclient,
  updateClient,
  getClientToken,
  uploadBusinessLogo,
  getBusinessLogoUrl,
  getAllMobileUsers,
  switchToUser,
} = require("../controllers/admincontroller");
const { authenticate, authorize } = require('../middleware/authenticate');
const router = express.Router();

// Public routes — no auth needed
router.post("/register", registerAdmin);
router.post("/login", loginAdmin);

// Protected routes — admin only
router.get("/getclients", authenticate, authorize('admin', 'super_admin'), getClients);
router.get("/getclientbyid/:id", authenticate, authorize('admin', 'super_admin'), getClientById);
router.post('/registerclient', authenticate, authorize('admin', 'super_admin'), registerclient);
router.delete('/deleteclient/:id', authenticate, authorize('admin', 'super_admin'), deleteclient);
router.put('/updateclient/:id', authenticate, authorize('admin', 'super_admin'), updateClient);
router.get('/get-client-token/:clientId', authenticate, authorize('admin', 'super_admin'), getClientToken);
router.post('/upload-business-logo', authenticate, authorize('admin', 'super_admin'), uploadBusinessLogo);
router.post('/get-business-logo-url', authenticate, authorize('admin', 'super_admin'), getBusinessLogoUrl);

// ── Switch User (Impersonation) — admin only ─────────────────────────────────
router.get('/users',              authenticate, authorize('admin', 'super_admin'), getAllMobileUsers);
router.post('/switch-user/:userId', authenticate, authorize('admin', 'super_admin'), switchToUser);

module.exports = router;
