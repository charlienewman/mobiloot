// Lets the app import ../shared (the stake pool and program clients also used by the
// API and ops scripts) while resolving its dependencies from this app's node_modules,
// so there is exactly one copy of @solana/web3.js in the bundle.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedDir = path.resolve(projectRoot, '../shared')
const config = getDefaultConfig(projectRoot)

config.watchFolders = [sharedDir]
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // tsconfig maps `buffer` to Node's types for type-checking only; bundle the npm package.
  if (moduleName === 'buffer') {
    return { type: 'sourceFile', filePath: require.resolve('buffer/index.js', { paths: [projectRoot] }) }
  }
  if (moduleName === '@zero/shared') {
    return { type: 'sourceFile', filePath: path.join(sharedDir, 'index.ts') }
  }
  if (context.originModulePath.startsWith(sharedDir + path.sep) && !moduleName.startsWith('.')) {
    return context.resolveRequest({ ...context, originModulePath: path.join(projectRoot, 'index.js') }, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
