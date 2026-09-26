import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Custom plugin to serve the /public folder for admin access in dev and copy to dist on build
function adminFolderPlugin() {
  return {
    name: 'serve-admin-public-folder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const parsedUrl = req.url.split('?')[0];
        
        if (parsedUrl === '/admin' || parsedUrl === '/admin/') {
          res.writeHead(302, { Location: '/admin/login.html' });
          res.end();
          return;
        }

        if (parsedUrl.startsWith('/admin/')) {
          const relativePath = parsedUrl.replace(/^\/admin\//, '');
          const filePath = path.resolve(__dirname, 'public', relativePath || 'login.html');

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'application/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.json': 'application/json',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.svg': 'image/svg+xml'
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.end(fs.readFileSync(filePath));
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      // Copy public admin folder to dist/admin on build
      const publicSrc = path.resolve(__dirname, 'public');
      const adminDest = path.resolve(__dirname, 'dist', 'admin');
      if (fs.existsSync(publicSrc)) {
        if (!fs.existsSync(adminDest)) {
          fs.mkdirSync(adminDest, { recursive: true });
        }
        const files = fs.readdirSync(publicSrc);
        for (const file of files) {
          const srcFile = path.join(publicSrc, file);
          const destFile = path.join(adminDest, file);
          if (fs.statSync(srcFile).isFile()) {
            fs.copyFileSync(srcFile, destFile);
          }
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), adminFolderPlugin()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    open: true,
  },
});
