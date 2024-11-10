const esbuild = require('esbuild')

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

let keepNodeAdltOnResolvePlugin = {
  name: 'keep-node-adlt-external',
  setup(build) {
    // we want to keep the require('node-adlt') in the code
    // but we don't want to bundle it
    build.onResolve({ filter: /^node-adlt$/ }, (args) => {
      return { path: args.path, external: true }
    })
  },
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: [{ out: 'extension', in: 'src/extension.ts' }],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outdir: 'out',
    external: ['vscode', 'node-adlt'],
    logLevel: 'silent',
    plugins: [
      keepNodeAdltOnResolvePlugin,
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  })
  if (watch) {
    await ctx.watch()
  } else {
    await ctx.rebuild()
    await ctx.dispose()
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started')
    })
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`)
        console.error(`    ${location.file}:${location.line}:${location.column}:`)
      })
      console.log('[watch] build finished')
    })
  },
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
