# outline/outline#12197 claim-differential diagnosis (raw)

Three re-runs on a freshly provisioned pre/post pair, via
`scripts/real-prs/hunt4-diagnose-outline.ts`. Verdict is not robust (1/3 errored,
2/3 falsified); every synthesized witness fails identically on base and head.

```
CLAIM (66 chars):
fix: Suspended users should not be included in cached member count
---
revertable changed files (3): server/models/Group.ts, server/models/decorators/CounterCache.ts, server/utils/__mocks__/CacheHelper.ts
provisioning outline pre/post (this is the slow step)...
[audit:execution-grounded:sandbox] provisioning outline/outline@778c8d00f9 -> /tmp/diag-outline-vNyskC/eg-outline-outline-778c8d00-LlMW4C
[audit:execution-grounded:sandbox] provisioning outline/outline@87bb79250d -> /tmp/diag-outline-vNyskC/eg-outline-outline-87bb7925-0JM4or

========== iteration 1/3 ==========
WITNESS (retried=false, regen=false):
import Group from "@server/models/Group";
import User from "@server/models/User";
import GroupUser from "@server/models/GroupUser";
import { buildGroup, buildUser } from "@server/test/factories";

describe("Group memberCount caching", () => {
  it("should not include suspended users in memberCount", async () => {
    const group = await buildGroup();
    const activeUser = await buildUser({ teamId: group.teamId });
    const suspendedUser = await buildUser({
      teamId: group.teamId,
      suspendedAt: new Date(),
    });

    await GroupUser.create({
      groupId: group.id,
      userId: activeUser.id,
      createdById: activeUser.id,
    });
    await GroupUser.create({
      groupId: group.id,
      userId: suspendedUser.id,
      createdById: suspendedUser.id,
    });

    const reloaded = await Group.findByPk(group.id);
    const count = await reloaded!.memberCount;

    expect(count).toEqual(1);
  });
});
---
arbiterAgreed=true (a=true/claude-sonnet-5, b=true/claude-haiku-4-5-20251001) closureLinked=true base=[errored,errored] head=errored
VERDICT: abstain:witness-not-runnable

========== iteration 2/3 ==========
WITNESS (retried=false, regen=false):
import { buildGroup, buildUser } from "@server/test/factories";
import GroupUser from "@server/models/GroupUser";

describe("Group memberCount", () => {
  it("should not include suspended users in memberCount", async () => {
    const group = await buildGroup();
    const activeUser = await buildUser({ teamId: group.teamId });
    const suspendedUser = await buildUser({
      teamId: group.teamId,
      suspendedAt: new Date(),
    });

    await GroupUser.create({
      groupId: group.id,
      userId: activeUser.id,
      createdById: activeUser.id,
    });

    await GroupUser.create({
      groupId: group.id,
      userId: suspendedUser.id,
      createdById: suspendedUser.id,
    });

    const updated = await group.reload();
    expect(updated.memberCount).toEqual(1);
  });
});
---
arbiterAgreed=true (a=true/claude-sonnet-5, b=true/claude-haiku-4-5-20251001) closureLinked=true base=[failed,failed] head=failed
VERDICT: claim-falsified-synthesized

========== iteration 3/3 ==========
WITNESS (retried=false, regen=false):
import { buildGroup, buildUser } from "@server/test/factories";
import { getTestDatabase } from "@server/test/support";

const db = getTestDatabase();

afterAll(db.disconnect);

beforeEach(db.flush);

describe("Group#memberCount", () => {
  it("should not include suspended users in cached member count", async () => {
    const group = await buildGroup();

    const activeUser = await buildUser({ teamId: group.teamId });
    const suspendedUser = await buildUser({
      teamId: group.teamId,
      suspendedAt: new Date(),
    });

    await group.$add("user", activeUser, {
      through: { createdById: activeUser.id },
    });
    await group.$add("user", suspendedUser, {
      through: { createdById: suspendedUser.id },
    });

    await group.reload();

    expect(group.memberCount).toEqual(1);
  });
});
---
arbiterAgreed=true (a=true/claude-sonnet-5, b=true/claude-haiku-4-5-20251001) closureLinked=true base=[failed,failed] head=failed
VERDICT: claim-falsified-synthesized
```
