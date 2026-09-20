require('dotenv').config();
const app = require('./src/app');
const { port } = require('./src/config/app.config');

// Hostinger's Node.js App Manager (and most other Node hosts) inject
// the real port via process.env.PORT — 3000 is only for local dev.
app.listen(port, () => {
  console.log(`Brine & Shell API listening on port ${port}`);
});
