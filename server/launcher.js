// Wait until the Windows launcher has assigned this process to its job.
const command = await new Promise((resolve) => {
  process.stdin.once('data', resolve)
  process.stdin.once('end', () => resolve(null))
})
process.stdin.pause()
if (command?.toString().trim() !== 'start') process.exit(1)

process.env.NODE_ENV = 'production'
process.env.HOST = '127.0.0.1'
process.env.FOUNDRY_ELECTRON_MAIN = 'true'
const { startServer } = await import('./index.js')
const server = startServer()
server.once('listening', () => {
  console.log(`FOUNDRY_READY http://127.0.0.1:${server.address().port}`)
})
server.once('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? 'The configured port is already in use. Close the other local server or set a different PORT in web/.env.'
    : error.message)
  process.exitCode = 1
})
