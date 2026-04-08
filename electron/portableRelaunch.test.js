import { describe, expect, it } from 'vitest'

import {
  buildPortableRelaunchOptions,
  getPortableRelaunchMarkerArg,
  isPortableRelaunchArg,
  shouldHandlePortableSecondInstance,
} from './portableRelaunch.js'

describe('portable relaunch helpers', () => {
  it('only handles packaged launches that have a portable wrapper path', () => {
    expect(
      shouldHandlePortableSecondInstance({
        env: {},
        isPackaged: true,
      }),
    ).toBe(false)

    expect(
      shouldHandlePortableSecondInstance({
        env: {
          PORTABLE_EXECUTABLE_FILE: 'C:\\Releases\\The-Foundry.exe',
        },
        isPackaged: false,
      }),
    ).toBe(false)

    expect(
      shouldHandlePortableSecondInstance({
        env: {
          PORTABLE_EXECUTABLE_FILE: 'C:\\Releases\\The-Foundry.exe',
        },
        isPackaged: true,
      }),
    ).toBe(true)
  })

  it('prefers the newly launched wrapper executable when available', () => {
    const relaunchOptions = buildPortableRelaunchOptions({
      argv: ['C:\\Users\\ant77\\AppData\\Local\\Temp\\123\\The Foundry.exe'],
      commandLine: ['D:\\Builds\\The-Foundry-0.0.1.exe', '--flag'],
      env: {
        PORTABLE_EXECUTABLE_FILE: 'D:\\Builds\\The-Foundry-0.0.0.exe',
        TEMP: 'C:\\Users\\ant77\\AppData\\Local\\Temp',
      },
      isPackaged: true,
    })

    expect(relaunchOptions).toEqual({
      args: [getPortableRelaunchMarkerArg()],
      execPath: 'D:\\Builds\\The-Foundry-0.0.1.exe',
    })
  })

  it('falls back to the current portable wrapper when the second instance reports a temp path', () => {
    const relaunchOptions = buildPortableRelaunchOptions({
      argv: [
        'C:\\Users\\ant77\\AppData\\Local\\Temp\\abc\\The Foundry.exe',
        '--debug',
        getPortableRelaunchMarkerArg(),
      ],
      commandLine: [
        'C:\\Users\\ant77\\AppData\\Local\\Temp\\def\\The Foundry.exe',
      ],
      env: {
        PORTABLE_EXECUTABLE_FILE: 'C:\\Users\\ant77\\Desktop\\The-Foundry.exe',
        TEMP: 'C:\\Users\\ant77\\AppData\\Local\\Temp',
      },
      isPackaged: true,
    })

    expect(relaunchOptions).toEqual({
      args: ['--debug', getPortableRelaunchMarkerArg()],
      execPath: 'C:\\Users\\ant77\\Desktop\\The-Foundry.exe',
    })
  })

  it('recognizes the relaunch marker argument', () => {
    expect(isPortableRelaunchArg(getPortableRelaunchMarkerArg())).toBe(true)
    expect(isPortableRelaunchArg('--something-else')).toBe(false)
  })
})
