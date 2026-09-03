const fs = require('fs');
const path = require('path');

const dataDirectory = path.join(__dirname, '../../data');
const dataFile = path.join(dataDirectory, 'store.json');
const defaults = { users: [], applications: [], payments: [], messages: [], subscribers: [] };

function read() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) };
  } catch {
    return { ...defaults, users: [], applications: [], payments: [], messages: [], subscribers: [] };
  }
}

function write(store) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

module.exports = { read, write };
