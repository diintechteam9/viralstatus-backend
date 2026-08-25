const express = require("express");
const { registerClient, loginClient, getClientKey, generateClientKey, deleteClientKey, loginClientWithKey } = require("../controllers/clientcontroller");
const { verifyToken } = require("../middleware/authmiddleware");
const router = express.Router();

router.get("/", (req, res) => {
    res.send("Hello client");
});

router.post("/register", registerClient)

router.post("/login", loginClient)

router.post("/login-with-key", loginClientWithKey)


// API Key Management Routes
router.get("/key", verifyToken, getClientKey);
router.post("/key/generate", verifyToken, generateClientKey);
router.delete("/key", verifyToken, deleteClientKey);

module.exports = router;
