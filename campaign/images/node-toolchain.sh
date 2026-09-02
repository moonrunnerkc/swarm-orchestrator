#!/bin/sh
# Installs node 24.15.0 into an image that is not the node image, pinned by the checksum
# nodejs.org published for the tarball, one per architecture the campaign builds for. The
# architecture is read from the machine rather than from a build argument, because the
# classic builder sets no TARGETARCH and an empty one pinned nothing.
set -eu
case "$(uname -m)" in
  x86_64) arch=x64; sum=44836872d9aec49f1e6b52a9a922872db9a2b02d235a616a5681b6a85fec8d89 ;;
  aarch64) arch=arm64; sum=73afc234d558c24919875f51c2d1ea002a2ada4ea6f83601a383869fefa64eed ;;
  *) echo "no node tarball is pinned for $(uname -m)" >&2; exit 1 ;;
esac
# The gzip tarball rather than the xz one: the go image carries no xz.
curl -fsSLo /tmp/node.tar.gz "https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-$arch.tar.gz"
echo "$sum  /tmp/node.tar.gz" | sha256sum -c -
tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1
rm /tmp/node.tar.gz
node --version
