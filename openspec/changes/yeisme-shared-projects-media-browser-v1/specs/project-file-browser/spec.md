## ADDED Requirements

### Requirement: 只整理 owner 成果引用
浏览器 MUST 以授权成果引用构成自动批次视图及手动目录，必须显式预览或播放，不因选择任务自动读取完整媒体。

#### Scenario: 文件夹中整理成果
- **WHEN** 创作者移动成果到项目内有效文件夹
- **THEN** 仅修改目录关系，原 owner、任务、artifact 与版本保持不变

### Requirement: 缩略图为专用授权衍生图
缩略图 MUST 使用 owner 衍生图合同，缺合同 MUST 保持明确状态，禁止降级为完整原图或视频。

#### Scenario: 撤权后迟到响应
- **WHEN** 权限版本或项目身份变化且旧缩略图响应随后返回
- **THEN** 旧缓存被清理且迟到结果不创建可复用 object URL
