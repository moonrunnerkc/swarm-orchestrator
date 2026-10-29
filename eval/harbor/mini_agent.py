"""Harbor's mini-swe-agent with one dependency fix: the litellm release it installs imports the
optional `mcp` package on every completion, so `mcp` is added to the same tool environment."""

from typing import override

from harbor.agents.installed.mini_swe_agent import MiniSweAgent
from harbor.environments.base import BaseEnvironment


class MiniAgent(MiniSweAgent):
    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.local/bin:$PATH"; '
                "uv tool install --force --python 3.12 mini-swe-agent "
                "--with litellm --with orjson --with fastapi --with mcp"
            ),
        )
