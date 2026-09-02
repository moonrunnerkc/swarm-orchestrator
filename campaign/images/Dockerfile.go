# The go arm image: go 1.23, node 24 for the CLI, the CLI from this tree's tarball.
FROM golang@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db
ARG SWARM_TARBALL
COPY node-toolchain.sh /tmp/node-toolchain.sh
RUN sh /tmp/node-toolchain.sh && rm /tmp/node-toolchain.sh
RUN git config --system safe.directory '*' && mkdir -p /home/campaign
COPY ${SWARM_TARBALL} /tmp/swarm.tgz
RUN npm install --global /tmp/swarm.tgz && rm /tmp/swarm.tgz
ENV HOME=/home/campaign
