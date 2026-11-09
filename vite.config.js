import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom plugin to serve the /public folder for admin access in dev and copy to dist on build
function adminFolderPlugin(clientEnv) {
  function syncEnvFile() {
    const envFilePath = path.resolve(__dirname, 'public', 'env.js');
    const envContent = `// Auto-generated from .env - do not edit manually or commit to version control\nwindow.__ENV__ = ${JSON.stringify(clientEnv, null, 2)};\n`;
    try {
      fs.writeFileSync(envFilePath, envContent, 'utf-8');
    } catch (_) {}
  }

  // Ensure public/env.js is in sync with .env
  syncEnvFile();

  function injectEnvToScript(content) {
    const envInjection = `const env = Object.assign(${JSON.stringify(clientEnv)}, (typeof window !== "undefined" && window.__ENV__) ? window.__ENV__ : {});`;
    return content.replace(/const env =[^;]*;\r?\n/, `${envInjection}\n`);
  }

  return {
    name: 'serve-admin-public-folder',
    buildStart() {
      syncEnvFile();
    },
    configureServer(server) {
      syncEnvFile();
      server.middlewares.use((req, res, next) => {
        const parsedUrl = req.url.split('?')[0];
        
        if (parsedUrl === '/admin' || parsedUrl === '/admin/') {
          res.writeHead(302, { Location: '/admin/login.html' });
          res.end();
          return;
        }

        if (parsedUrl === '/env.js' || parsedUrl === '/admin/env.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.end(`window.__ENV__ = ${JSON.stringify(clientEnv, null, 2)};\n`);
          return;
        }

        if (parsedUrl === '/app.js' || parsedUrl === '/admin/app.js') {
          const filePath = path.resolve(__dirname, 'public', 'app.js');
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            const content = fs.readFileSync(filePath, 'utf-8');
            res.end(injectEnvToScript(content));
            return;
          }
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
            if (ext === '.js' && (relativePath === 'app.js' || filePath.endsWith('app.js'))) {
              const content = fs.readFileSync(filePath, 'utf-8');
              res.end(injectEnvToScript(content));
            } else {
              res.end(fs.readFileSync(filePath));
            }
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      syncEnvFile();
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
            if (file === 'app.js') {
              const content = fs.readFileSync(srcFile, 'utf-8');
              fs.writeFileSync(destFile, injectEnvToScript(content), 'utf-8');
            } else {
              fs.copyFileSync(srcFile, destFile);
            }
          }
        }
      }
      // Also update dist/app.js if it was copied by Vite
      const distAppJs = path.resolve(__dirname, 'dist', 'app.js');
      if (fs.existsSync(distAppJs)) {
        const content = fs.readFileSync(distAppJs, 'utf-8');
        fs.writeFileSync(distAppJs, injectEnvToScript(content), 'utf-8');
      }
      // Also ensure dist/env.js exists
      const distEnvJs = path.resolve(__dirname, 'dist', 'env.js');
      fs.writeFileSync(distEnvJs, `window.__ENV__ = ${JSON.stringify(clientEnv, null, 2)};\n`, 'utf-8');
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const clientEnv = {
    VITE_FIREBASE_API_KEY: env.VITE_FIREBASE_API_KEY || '',
    VITE_FIREBASE_AUTH_DOMAIN: env.VITE_FIREBASE_AUTH_DOMAIN || '',
    VITE_FIREBASE_PROJECT_ID: env.VITE_FIREBASE_PROJECT_ID || '',
    VITE_FIREBASE_STORAGE_BUCKET: env.VITE_FIREBASE_STORAGE_BUCKET || '',
    VITE_FIREBASE_MESSAGING_SENDER_ID: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    VITE_FIREBASE_APP_ID: env.VITE_FIREBASE_APP_ID || '',
    VITE_FIREBASE_MEASUREMENT_ID: env.VITE_FIREBASE_MEASUREMENT_ID || '',
    VITE_ADMIN_EMAIL: env.VITE_ADMIN_EMAIL || 'admin@shop.com',
    VITE_SHOP_LAT: env.VITE_SHOP_LAT || '28.6139',
    VITE_SHOP_LNG: env.VITE_SHOP_LNG || '77.2090',
    VITE_DELIVERY_RADIUS_KM: env.VITE_DELIVERY_RADIUS_KM || '5',
    VITE_MAPBOX_TOKEN: env.VITE_MAPBOX_TOKEN || '',
  };

  return {
    plugins: [react(), adminFolderPlugin(clientEnv)],
    build: {
      outDir: 'dist',
    },
    server: {
      port: 5173,
      open: true,
    },
  };
});
