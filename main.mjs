import { createServer } from './covenant-server.mjs';

const port = Number(process.env.PORT || 3000);
createServer().listen(port, '0.0.0.0', () => {
  console.log(`COVENANT ready on 0.0.0.0:${port}`);
});
