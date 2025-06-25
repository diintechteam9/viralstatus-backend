const express = require("express");
const { 
  registerAdmin, 
  loginAdmin, 
  getClients, 
  getClientById, 
  registerclient, 
  deleteclient,
  getClientToken 
} = require("../controllers/admincontroller");
const { authMiddleware } = require("../middleware/authmiddleware");
const router = express.Router();

router.get("/", (req, res) => {
    res.send("Hello admin");
});

router.post("/register", registerAdmin);

router.post("/login", loginAdmin);

router.get("/getclients", getClients);

router.get("/getclientbyid/:id", getClientById);

router.post('/registerclient', registerclient);

router.delete('/deleteclient/:id', deleteclient);

// Get client token for admin access
router.get('/get-client-token/:clientId', authMiddleware, getClientToken);

module.exports = router;
