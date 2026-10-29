"""Harbor adapter for `swarm run`: one bash tool, judged by swarm's own verifier in the task
container, then by the benchmark's tests outside it.

The package is the tarball eval/run.mjs packs from this checkout (SWARM_EVAL_PACKAGE), and the
endpoint and model are the ones every arm of the evaluation uses (SWARM_EVAL_ENDPOINT, -m).
"""

import os
import re
import shlex
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

# A workspace that is not a git repository gets one, so swarm has a base to judge against.
_SNAPSHOT = (
    "if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then "
    "git init -q && git add -A && git -c user.name=agent -c user.email=agent@localhost "
    "commit -q --no-verify --allow-empty -m 'Task files before agent run'; fi"
)


class SwarmAgent(BaseInstalledAgent):
    @staticmethod
    @override
    def name() -> str:
        return "swarm-run"

    @override
    def get_version_command(self) -> str | None:
        return ". $HOME/.nvm/nvm.sh >/dev/null 2>&1; swarm --version"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.ensure_system_dependencies(environment, ("curl", "bash", "git"))
        await environment.upload_file(os.environ["SWARM_EVAL_PACKAGE"], "/tmp/swarm.tgz")
        await self.exec_as_agent(
            environment,
            command=f"set -euo pipefail; {nvm_node_install_snippet(24)} && npm install -g /tmp/swarm.tgz && swarm --version",
        )

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        pass

    @override
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        model = (self.model_name or "").split("/", 1)[-1]
        steps = os.environ.get("SWARM_EVAL_MAX_STEPS", "50")
        command = (
            f". $HOME/.nvm/nvm.sh >/dev/null 2>&1; {_SNAPSHOT}; "
            f"swarm run {shlex.quote(instruction)} --endpoint {shlex.quote(os.environ['SWARM_EVAL_ENDPOINT'])} "
            f"--model {shlex.quote(model)} --approve auto --max-steps {shlex.quote(steps)}; "
            # A budget stop exits nonzero, which is an outcome here rather than a harness error.
            'echo "swarm-exit $?"'
        )
        result = await self.exec_as_agent(environment, command=command)
        output = f"{getattr(result, 'stdout', '') or ''}"
        (self.logs_dir / "swarm-run.txt").write_text(output + (getattr(result, "stderr", "") or ""))
        tokens = re.search(r"^tokens\s+(\d+)", output, re.MULTILINE)
        if tokens is not None:
            # swarm reports one total; it is recorded as input so the runner's sum stays exact.
            context.n_input_tokens = int(tokens.group(1))
            context.n_output_tokens = 0
