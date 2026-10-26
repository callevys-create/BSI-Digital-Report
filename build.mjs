import {build} from 'esbuild';
await build({entryPoints:['exports.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'exports-client.js',minify:true});
