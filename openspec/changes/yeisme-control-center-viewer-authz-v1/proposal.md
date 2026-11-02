# Yeisme 控制中心：只读角色不能执行管理与付费动作 v1

## Why

第五轮规划时读代码发现：`/actions/preview` 与 `/actions/confirm` 只对协作类动作做授权，`admin.user.create/revoke`、`provider_runs.*`、`task.cancel`、`project.metadata.*`、`collection.record.*` 都不检查角色；`POST /provider-runs` 与 reconcile 也不检查。viewer 因此能新建或吊销管理员、花 Provider 预算。线上三个账号都是管理员，目前没有暴露；但本轮要建只读复验账号，必须先修。

## What Changes

- 非协作类动作在 preview 与 confirm 两处都要求 admin，否则 403 `control_center_admin_required`；confirm 重新检查，所以降级前生成的预览也执行不了。
- `admin.*` 账号动作另外要求个人会话（与 `/admin/personal-users` 一致）。
- `POST /provider-runs` 与 `/provider-runs/:id/reconcile` 在读请求体与查运行之前就要求 admin。
- 本轮其他工作要用的配置类型（凭据到期 `CredentialLifecycle`、`observation`）一并加进 `server/contracts.ts`，只是类型，没有行为。

## Impact

- 没有角色的团队模式身份按既有规则就是 viewer（`auth.role()`），因此也不能再执行这些动作；个人模式的旧账号按 `personal.role`、个人用户按各自角色，线上三个账号都是 admin，不受影响。
- 协作类动作仍按项目授权，不变。
