const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Client = require('./models/client');
  const Account = require('./models/Account');
  const emails = ['software9517@gmail.com', 'sanilkumarsingh714@gmil.com'];
  const clients = await Client.find({ email: { $in: emails } }, '_id email').lean();
  console.log('Deleting:', clients.map(c => c.email));
  const ids = clients.map(c => c._id.toString());
  await Client.deleteMany({ email: { $in: emails } });
  await Account.deleteMany({ userId: { $in: ids } });
  console.log('Done!');
  process.exit();
});
