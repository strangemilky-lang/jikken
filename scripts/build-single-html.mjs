import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const outputArg = process.argv[2];
const outputPath = outputArg
  ? path.resolve(rootDir, outputArg)
  : path.resolve(rootDir, 'dist', 'strip-hero.html');
const tmpDir = path.resolve(rootDir, '.singlefile-tmp');

function resolveDistAsset(href) {
  const cleaned = href.replace(/^\.?\//, '').split('?')[0].split('#')[0];
  return path.resolve(tmpDir, cleaned);
}

function escapeInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function escapeInlineStyle(css) {
  return css.replace(/<\/style/gi, '<\\/style');
}

async function main() {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });

    await viteBuild({
      root: rootDir,
      base: './',
      logLevel: 'warn',
      build: {
        outDir: tmpDir,
        emptyOutDir: true,
        cssCodeSplit: false,
        sourcemap: false,
        assetsInlineLimit: 100_000_000,
      },
    });

    const builtHtmlPath = path.join(tmpDir, 'index.html');
    if (!fs.existsSync(builtHtmlPath)) {
      throw new Error('Vite build did not produce index.html');
    }

    let html = fs.readFileSync(builtHtmlPath, 'utf8');

    // Collect and remove external stylesheet <link> tags
    const cssChunks = [];
    html = html.replace(
      /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
      (tag) => {
        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
        if (!hrefMatch) return tag;
        const cssFile = resolveDistAsset(hrefMatch[1]);
        if (fs.existsSync(cssFile)) {
          cssChunks.push(fs.readFileSync(cssFile, 'utf8'));
          return '';
        }
        return tag;
      },
    );

    // Remove modulepreload hints
    html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/gi, '');

    // Collect and convert module <script src="..."> bundles to classic IIFE for file:// compatibility
    const jsChunks = [];
    const scriptMatches = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi)];
    for (const m of scriptMatches) {
      const fullTag = m[0];
      const src = m[1];
      const jsFile = resolveDistAsset(src);
      if (!fs.existsSync(jsFile)) continue;

      const bundled = await esbuild({
        entryPoints: [jsFile],
        bundle: true,
        format: 'iife',
        minify: true,
        target: 'es2020',
        write: false,
      });
      if (!bundled.outputFiles?.[0]) {
        throw new Error(`esbuild failed to convert ${jsFile} to IIFE`);
      }
      jsChunks.push(bundled.outputFiles[0].text);
      html = html.replace(fullTag, '');
    }

    if (jsChunks.length === 0) {
      throw new Error('No built script bundle found in index.html');
    }

    const inlineStyleTag =
      cssChunks.length > 0
        ? `<style>\n${escapeInlineStyle(cssChunks.join('\n'))}\n</style>`
        : '';
    const inlineScriptTag = `<script>\n${escapeInlineScript(jsChunks.join('\n'))}\n</script>`;

    if (inlineStyleTag) {
      html = html.replace(/<\/head>/i, () => `${inlineStyleTag}\n  </head>`);
    }
    html = html.replace(/<\/body>/i, () => `${inlineScriptTag}\n  </body>`);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf8');

    const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
    console.log(`[build:html] Generated standalone HTML: ${path.relative(rootDir, outputPath)} (${sizeKb} KB)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[build:html] Failed:', err);
  process.exit(1);
});
