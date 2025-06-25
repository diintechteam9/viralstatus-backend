const express = require("express");
const { registerClient, loginClient } = require("../controllers/clientcontroller");
const router = express.Router();

router.get("/", (req, res) => {
    res.send("Hello client");
});

router.post("/register", registerClient)

router.post("/login", loginClient)




module.exports = router;
