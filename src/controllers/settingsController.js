const { read, write } = require('../services/localStore');

function getSettings(req, res) {
  const store = read();
  const settings = store.users.find((user) => user.id === req.user.id)?.settings || { emailNotifications: true, smsNotifications: false, darkMode: false };
  res.json(settings);
}

function updateSettings(req, res) {
  const store = read();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.settings = { ...(user.settings || {}), ...req.body };
  write(store);
  res.json(user.settings);
}

function updatePrivacy(req, res) {
  return updateSettings(req, res);
}

module.exports = { getSettings, updateSettings, updatePrivacy };
