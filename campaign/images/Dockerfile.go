# The go arm image: go 1.27, node 24 for the CLI, the CLI from this tree's tarball.
FROM golang@sha256:648f440f42a0958804efb24df176f806f9d353b41f1c0627f666428e40310f6b
ARG SWARM_TARBALL
COPY node-toolchain.sh /tmp/node-toolchain.sh
RUN sh /tmp/node-toolchain.sh && rm /tmp/node-toolchain.sh
RUN git config --system safe.directory '*' && mkdir -p /home/campaign
COPY ${SWARM_TARBALL} /tmp/swarm.tgz
RUN npm install --global /tmp/swarm.tgz && rm /tmp/swarm.tgz
ENV HOME=/home/campaign
