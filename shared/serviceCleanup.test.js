import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  default: fsMock,
  mkdir: fsMock.mkdir,
  readFile: fsMock.readFile,
  writeFile: fsMock.writeFile,
}))

vi.mock('node:child_process', () => ({
  default: {
    spawn: spawnMock,
  },
  spawn: spawnMock,
}))

function createChildProcess({ code = 0, stdout = '', stderr = '' } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()

  queueMicrotask(() => {
    if (stdout) {
      child.stdout.emit('data', Buffer.from(stdout))
    }

    if (stderr) {
      child.stderr.emit('data', Buffer.from(stderr))
    }

    child.emit('close', code)
  })

  return child
}

describe('service cleanup', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('recognizes a Foundry-owned local API process by command line and path', async () => {
    const { isFoundryOwnedProcess } = await import('./serviceCleanup.js')

    expect(
      isFoundryOwnedProcess(
        {
          commandLine:
            'node.exe "C:\\Users\\ant77\\Desktop\\The Foundry\\server\\index.js"',
          executablePath: 'C:\\Program Files\\nodejs\\node.exe',
          name: 'node.exe',
        },
        {
          appRoot: 'C:\\Users\\ant77\\Desktop\\The Foundry',
          execPath: 'C:\\Users\\ant77\\Desktop\\The Foundry\\The Foundry.exe',
        },
      ),
    ).toBe(true)
  })

  it('kills a recorded stale Foundry service and clears it from the registry', async () => {
    fsMock.readFile.mockResolvedValue(
      JSON.stringify({
        services: [
          {
            kind: 'local-api',
            pid: 4321,
            port: 3001,
            registeredAt: '2026-04-07T12:00:00.000Z',
            workingDirectory: 'C:\\Users\\ant77\\Desktop\\The Foundry',
          },
        ],
      }),
    )
    fsMock.mkdir.mockResolvedValue(undefined)
    fsMock.writeFile.mockResolvedValue(undefined)

    spawnMock.mockImplementation((command, args) => {
      if (command === 'powershell.exe') {
        const script = args.at(-1)

        if (script.includes('Get-CimInstance Win32_Process -Filter "ProcessId = 4321"')) {
          return createChildProcess({
            stdout: JSON.stringify({
              CommandLine:
                'node.exe "C:\\Users\\ant77\\Desktop\\The Foundry\\server\\index.js"',
              ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
              Name: 'node.exe',
              ProcessId: 4321,
            }),
          })
        }

        if (script.includes('Get-NetTCPConnection -State Listen -LocalPort 3001')) {
          return createChildProcess({
            stdout: JSON.stringify([]),
          })
        }
      }

      if (command === 'taskkill.exe') {
        expect(args).toEqual(['/PID', '4321', '/T', '/F'])
        return createChildProcess()
      }

      throw new Error(`Unexpected command: ${command}`)
    })

    const { cleanupStaleServices } = await import('./serviceCleanup.js')
    const result = await cleanupStaleServices({
      appRoot: 'C:\\Users\\ant77\\Desktop\\The Foundry',
      currentPid: 1111,
      defaultPort: 3001,
      execPath: 'C:\\Users\\ant77\\Desktop\\The Foundry\\The Foundry.exe',
      platform: 'win32',
      productName: 'The Foundry',
      resourcesPath: 'C:\\Users\\ant77\\Desktop\\The Foundry\\resources',
    })

    expect(result.terminatedServices).toEqual([
      {
        kind: 'local-api',
        pid: 4321,
        port: 3001,
        source: 'registry',
      },
    ])
    expect(result.remainingServices).toEqual([])
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1)

    const [, writtenJson] = fsMock.writeFile.mock.calls[0]
    expect(JSON.parse(writtenJson)).toEqual({ services: [] })
  })
})
