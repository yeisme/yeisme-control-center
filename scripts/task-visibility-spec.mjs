import fs from 'node:fs';
import path from 'node:path';
const base=path.resolve(import.meta.dirname,'..');
const owners=[['.','yeisme-task-visibility-v1','控制中心','bun run typecheck && bun run test && bun run build'],['../..','yeisme-task-visibility-program-v1','跨项目合同','openspec validate yeisme-task-visibility-program-v1 --strict'],['../../cli/eikona','eikona-task-observation-v1','Eikona','go test ./internal/controlplane ./internal/mcp ./internal/index'],['../../cli/sonora','sonora-task-observation-v1','Sonora','go test ./internal/mcp ./internal/services/jobs ./internal/api'],['../../agent/scaena','scaena-task-observation-v1','Scaena','go test ./internal/productionbackend/app ./sdk/contract'],['../scaena-studio','studio-task-observation-v1','片场','bun run typecheck && bun run test && bun run build']];
const stages=['CONTRACT：固定可观察任务、进度、权限、结果与取消边界','BACKEND：本 owner 的授权观测与兼容实现','FRONTEND：本 owner 的公开合同消费者（非界面 owner 仅检查消费合同）','INTEGRATION：本 owner 隔离证据；真实部署和授权独立记账'];
for(const [relative,id,owner,check] of owners){
 const dir=path.resolve(base,relative,'openspec/changes',id);
 if(!fs.existsSync(path.join(dir,'.openspec.yaml')))throw Error('Create OpenSpec skeleton first: '+id);
 const write=(name,body)=>{const file=path.join(dir,name);if(fs.existsSync(file))return;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body+'\n');};
 write('proposal.md',`## Why\nMCP任务缺少持续可见的执行进展和产物入口，需要个人内网控制台和片场共享授权事实。\n\n## What Changes\n- 任务接受后可发现；阶段、计数、时间和数据新鲜度分开。\n- 个人会话与owner连接分离；结果读取独立授权，取消明确确认。\n- 不自动恢复执行、重试或付费，不部署、不改真实凭据、不运行race。\n\n## Capabilities\n### New Capabilities\n- task-observation: 有界授权任务观测及恢复定位。\n\n## Impact\n${owner}只改自己的合同和源码。split-owner；原任务、权限、账本仍归领域owner。`);
 write('design.md',`## Context\n执行用户已批准的三服务+片场计划。既有源码依赖未提交工作，控制中心为未初始提交仓库，因此单写入者在当前checkout串行实施；独立临时数据和端口，不切换分支，不提交。\n\n## Decisions\n- 复用application service，不shell out、不读其他owner私有存储。\n- schema_version=yeisme.task_observation.v1；locator={owner,instance_id,project,task_family,task_ref}。\n- snapshot含state/native_state、stage、progress(kind,count,percent)、created_at/updated_at/observed_at、results、allowed_actions、revision与coverage。缺失值null，不虚构百分比。\n- MCP动作control_center.capabilities、control_center.tasks.list/get/events/cancel；前四项不推进执行。\n- 个人连接固定endpoint/project/credential_ref，当前身份与内容权限由owner再验证。\n- 实时队列与固定历史查询分离，活动任务不能被24小时窗口过滤。\n- 取消需要额外权限、幂等与回执；无此合同显示不可用，不模拟成功。\n- 先冻结合同，再分端实现；另一端未验收时INTEGRATION_PENDING。\n\n\`\`\`mermaid\nflowchart LR\n C[控制中心] --> B[同源会话和固定连接]\n B --> O[各owner公开观测]\n S[片场] --> F[Scaena facade]\n F --> O\n\`\`\`\n\n## Verification\n本owner聚焦命令：\`${check}\`。集成六件套写temp/integration-test-runs；失败保留证据。普通测试不调用真实provider。\n\n## Rollback\n新增合同可关闭，保留旧API/MCP动作；不删除历史任务、结果与凭据，不回滚账本。部署和真实权限启用独立授权。`);
 write('tasks.md',`# ${owner} 实施\n\n${stages.map((s,i)=>`- [ ] ${i+1}.1 ${s}；owner=${owner}；scope=本项目；依赖=${i?i+'.1':'无'}；lane=串行；验证=${check}；预期=合同兼容、无越权；失败=保留证据并重跑聚焦用例`).join('\n')}\n\n本清单由 scripts/task-visibility-spec.mjs 生成；进展用 mark 更新，不手改状态。`);
 write('specs/task-observation/spec.md','## ADDED Requirements\n\n### Requirement: Authorized task observation\n系统 SHALL 返回当前授权范围内的任务、真实阶段、计数、原始状态和观察时间，不因刷新触发执行。\n\n#### Scenario: 生成尚未结束\n- **WHEN** MCP任务已受理且provider仍在执行\n- **THEN** 控制台可以找到任务并展示未知百分比及真实阶段\n\n#### Scenario: 范围或权限改变\n- **WHEN** 当前身份切换项目或权限撤销\n- **THEN** 清除旧内容并拒绝迟到响应与越权媒体访问\n\n### Requirement: Recovery without resubmission\n系统 SHALL 保留原任务引用；取消和内容读取必须独立授权，不自动生成新尝试。\n\n#### Scenario: 结果未知\n- **WHEN** 客户端中断或事件游标过期\n- **THEN** 查询原snapshot，未确认结果不重投、不伪造成功');
}
if(process.argv[2]==='note'){
 const [id,phase,status,evidence]=process.argv.slice(3);const owner=owners.find(v=>v[1]===id);
 if(!owner||!['CONTRACT','BACKEND','FRONTEND','INTEGRATION'].includes(phase)||!['PHASE_PASS','PHASE_FAIL','BLOCKED','INTEGRATION_PENDING'].includes(status)||!evidence||/[\r\n]/.test(evidence))throw Error('Use note <change> <phase> <status> <evidence>');
 const file=path.resolve(base,owner[0],'openspec/changes',id,'tasks.md');fs.appendFileSync(file,`\n阶段记录：${phase} ${status}；${evidence}\n`);
}
if(process.argv[2]==='mark'){
 const [id,task,evidence]=process.argv.slice(3);const owner=owners.find(v=>v[1]===id);if(!owner||!/^\d+\.\d+$/.test(task)||!evidence||/[\r\n]/.test(evidence))throw Error('Use mark <change> <task> <evidence>');
 const file=path.resolve(base,owner[0],'openspec/changes',id,'tasks.md');const body=fs.readFileSync(file,'utf8');const old='- [ ] '+task+' ';if(!body.includes(old))throw Error('Pending task not found');fs.writeFileSync(file,body.replace(old,'- [x] '+task+' ')+`\n验证 ${task}：${evidence}\n`);
}
console.log('Owner-scoped task-observation specifications updated; no runtime configuration changed.');
