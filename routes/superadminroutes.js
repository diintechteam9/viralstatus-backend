const express = require("express");
const { registerSuperadmin, loginSuperadmin, getadmins, deleteadmin, registeradmin, getclients, deleteclient, registerclient } = require("../controllers/superadmincontroller");
const router = express.Router();

router.get("/", (req, res) => {
    res.send("Hello superadmin");
});

router.post("/register", registerSuperadmin);

router.post("/create-test", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    const existing = await require("../models/superadmin").findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Superadmin already exists" });
    }

    const bcrypt = require("bcrypt");
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const Superadmin = require("../models/superadmin");
    const superadmin = await Superadmin.create({ name, email, password: hashedPassword });

    res.status(201).json({
      success: true,
      message: "Superadmin created successfully",
      data: superadmin
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/login", loginSuperadmin);

router.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    if (!email || !newPassword) {
      return res.status(400).json({ message: "Email and new password are required" });
    }

    const Superadmin = require("../models/superadmin");
    const superadmin = await Superadmin.findOne({ email });
    
    if (!superadmin) {
      return res.status(404).json({ message: "Superadmin not found" });
    }

    const bcrypt = require("bcrypt");
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await Superadmin.updateOne({ email }, { password: hashedPassword });

    res.status(200).json({
      success: true,
      message: "Password reset successfully"
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/getadmins', getadmins);

router.delete('/deleteadmin/:id', deleteadmin);

router.post('/registeradmin', registeradmin);

router.get('/getclients', getclients);

router.delete('/deleteclient/:id', deleteclient);

router.post('/registerclient', registerclient);

module.exports = router;
