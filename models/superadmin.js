const mongoose = require("mongoose");

const superadminSchema = new mongoose.Schema({
    name:
    {
        type: String,
        required: true,
    },
    email:
    {
        type: String,
        required: true,
    },
    password: 
    {
        type: String,
        required: true,
    },
    createdAt:
    {
        type: Date,
        default: Date.now,
    },
});

const Superadmin = mongoose.model("Superadmin", superadminSchema);

module.exports = Superadmin;
