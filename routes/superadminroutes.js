const express = require("express");
const { registerSuperadmin, loginSuperadmin, getadmins, deleteadmin, registeradmin, getclients, deleteclient, registerclient } = require("../controllers/superadmincontroller");
const router = express.Router();

router.get("/", (req, res) => {
    res.send("Hello superadmin");
});

router.post("/register", registerSuperadmin);

router.post("/login", loginSuperadmin);

router.get('/getadmins', getadmins);

router.delete('/deleteadmin/:id', deleteadmin);

router.post('/registeradmin', registeradmin);

router.get('/getclients', getclients);

router.delete('/deleteclient/:id', deleteclient);

router.post('/registerclient', registerclient);

module.exports = router;
