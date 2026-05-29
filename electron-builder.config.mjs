const version = process.env.npm_package_version ?? '0.0.0'

export default {
  appId: 'com.thefoundry.desktop',
  artifactName: 'The-Foundry-${version}.${ext}',
  asar: true,
  asarUnpack: [
    'node_modules/ffmpeg-static/**',
    'node_modules/sharp/**',
    'node_modules/@img/**',
  ],
  compression: 'normal',
  copyright: `Copyright (c) ${new Date().getFullYear()} The Foundry`,
  cscKeyPassword:
    process.env.WIN_CSC_KEY_PASSWORD ??
    process.env.CSC_KEY_PASSWORD ??
    undefined,
  cscLink:
    process.env.WIN_CSC_LINK ??
    process.env.CSC_LINK ??
    undefined,
  directories: {
    buildResources: 'build',
    output: 'release',
  },
  executableName: 'The Foundry',
  files: [
    'dist/**/*',
    'electron/**/*',
    'server/**/*',
    '!server/data/**/*',
    'shared/**/*',
    'package.json',
  ],
  forceCodeSigning: process.env.REQUIRE_WINDOWS_SIGNING === 'true',
  npmRebuild: true,
  productName: 'The Foundry',
  portable: {
    artifactName: `The-Foundry-${version}.exe`,
  },
  win: {
    icon: 'icon.ico',
    legalTrademarks: 'The Foundry',
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: true,
    target: [
      {
        arch: ['x64'],
        target: 'portable',
      },
    ],
  },
}
