/// <reference lib="deno.unstable" />
import {serveDir} from 'jsr:@std/http/file-server';
import {join} from 'jsr:@std/path';
import * as esbuild from 'esbuild';
import {denoPlugin} from '@deno/esbuild-plugin';
import {MapDataItem} from './types/map.ts';
import {query} from './backend/backend.ts';

const publicRoot = join(Deno.cwd(), 'public');

let mapData: MapDataItem[] = []; //
Deno.serve(async (req) => {
	const kv = await Deno.openKv();

	const pathname = new URL(req.url).pathname;

	// /api
	if (req.method === 'POST' && pathname === '/api/save-data') {
		try {
			const body = await req.json();
			if (Array.isArray(body)) {
				mapData = body;
			}
			return new Response(JSON.stringify({ status: 'ok' }), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (err) {
			const errmsg = err instanceof Error ? err.message : String(err);
			return new Response(
				JSON.stringify({ error: errmsg }),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}
	}

	if (req.method === 'GET' && pathname === '/api/load-data') {
		return new Response(JSON.stringify(mapData), {
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// TypeScript ファイル処理
	if (pathname.endsWith('.ts')) {
		const env = Deno.env.get('DENO_ENV') || 'development';
		
		if (env === 'production') {
			// プロダクション環境：事前ビルド済みJSファイルを配信
			const jsPath = pathname.replace('.ts', '.js');
			const jsFilePath = join(publicRoot, jsPath);
			
			try {
				const jsContent = await Deno.readTextFile(jsFilePath);
				return new Response(jsContent, {
					headers: {
						'Content-Type': 'application/javascript; charset=utf-8',
						'Cache-Control': 'public, max-age=31536000, immutable',
					},
				});
			} catch (error) {
				console.error(`Pre-built JS file not found: ${jsFilePath}`);
				return new Response(`Pre-built JavaScript file not found: ${jsPath}. Run 'deno task build:all' to generate bundle files.`, {
					status: 404,
				});
			}
		} else {
			// 開発環境：動的バンドル
			const tsPath = join(publicRoot, pathname);
			try {
				const result = await esbuild.build({
					entryPoints: [tsPath],
					plugins: [denoPlugin()],
					bundle: true,
					write: false,
					format: 'esm',
				});

				const code = result.outputFiles[0].text;

				return new Response(code, {
					headers: {
						'Content-Type': 'application/javascript; charset=utf-8',
						'Cache-Control': 'no-cache, no-store, must-revalidate',
					},
				});
			} catch (error) {
				const errorMessage = error && error instanceof Error
					? error.message
					: String(error);
				console.error('esbuild build error:', error);
				return new Response(`TypeScript bundling error: ${errorMessage}`, {
					status: 500,
				});
			}
		}
	}

    // 特定のAPIエンドポイントのみバックエンド処理
    if (pathname === '/welcome-message' || 
        pathname === '/post-json' || 
        pathname === '/query-json') {
        return await query(kv, req);
    }
    
	return serveDir(req, {
		fsRoot: 'public',
		urlRoot: '',
		showDirListing: true,
		enableCors: true,
	});
});
