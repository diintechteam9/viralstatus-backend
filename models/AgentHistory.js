const mongoose = require('mongoose');

const AgentHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, refPath: 'userModel' },
  userModel: { type: String, enum: ['Client', 'User'] },
  agentId: { type: String, enum: ['yo', 'vo', 'yovo'], required: true },
  task: { type: String, required: true },
  // for yo/vo single agent
  response: { type: String, default: '' },
  // for yovo collab
  yoOutput: { type: String, default: '' },
  voOutput: { type: String, default: '' },
  yovoSummary: { type: String, default: '' },
  status: { type: String, enum: ['completed', 'stopped'], default: 'completed' },
}, { timestamps: true });

module.exports = mongoose.model('AgentHistory', AgentHistorySchema);
