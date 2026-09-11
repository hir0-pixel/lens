# Prime Agent vendoring record

## `@earendil-works/pi-agent-core`

- Version: `0.85.1`
- npm integrity: `sha512-hIXIP3eAWueAYiAl8aMvWCvvZ8Q5gT3Dip5bE5uJyIGh4+YlWRjtMLI4BaeoXoSs93zndjue61u1B/vhefLnuA==`
- npm SHA-1: `8a85116c0d4494e4d9e82341237d91ad360fdc2a`
- Source: `https://github.com/earendil-works/pi.git`
- Source commit recorded by npm: `d981de1229ef899957bbe968bc8dcda02a21f477`

## `@earendil-works/pi-ai`

- Version: `0.85.1`
- npm integrity: `sha512-+VgVIJDkDO2efYJKEEqvPTH4zmnIaXdAppGbO+vKFA9qy5PdhFiAenuFAkU+oiCSfOC4dMHDyrjdQeL4ZoC5CQ==`
- npm SHA-1: `3f5726032c30149f6060a3aeacb79436c7387a37`

Both exact npm tarballs are retained for offline installation, with their
contents unpacked alongside them for audit. The upstream MIT licence is
preserved with each package. Neither `pi-coding-agent` nor `pi-tui` is
vendored.

## Install-script review

No transitive install scripts were approved for M0. Installation used
`npm install --ignore-scripts --prefer-online`; the harness isolation tests do
not need the `esbuild`, `@google/genai`, or `protobufjs` install scripts.
