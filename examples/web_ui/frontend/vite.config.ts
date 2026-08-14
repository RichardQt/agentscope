import path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
	plugins: [react(), tailwindcss(), svgr()],
	server: {
		host: '0.0.0.0',
		proxy: {
			'/api': 'http://localhost:3000',
			// Same-origin path for the Python Agent Service. Avoids CORS
			// preflight on every X-User-ID request (the chat SSE stream
			// already occupies one of Chrome's 6 HTTP/1.1 slots per host).
			'/as-api': {
				target: 'http://127.0.0.1:8002',
				changeOrigin: true,
				rewrite: (p) => p.replace(/^\/as-api/, '') || '/',
				timeout: 0,
				configure: (proxy) => {
					proxy.on('proxyRes', (proxyRes) => {
						const ct = proxyRes.headers['content-type'];
						if (typeof ct === 'string' && ct.includes('text/event-stream')) {
							proxyRes.headers['cache-control'] = 'no-cache, no-transform';
							proxyRes.headers['x-accel-buffering'] = 'no';
						}
					});
				},
			},
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'next/navigation': path.resolve(__dirname, './src/lib/next-navigation-shim.ts'),
		},
	},
	optimizeDeps: {
		include: ['mime-types'],
	},
});
