# State Schema

生产状态存于项目根目录 `.blender-agent/state.json`。
它是编排器唯一的判断依据，必须随每次 gate 变化写回。

---

## 1. 目录结构

```text
.blender-agent/
├── state.json
├── qa/
│   ├── <gate>-<n>.json
│   └── <gate>-<n>/            # 该轮截图
├── renders/
├── checkpoints/
└── reports/
```

---

## 2. 完整 schema

```json
{
  "version": 1,
  "asset": {
    "name": "orc_warrior",
    "kind": "character",
    "target": "game",
    "style": "realistic",
    "delivery": ["fbx", "normal", "albedo", "orm"]
  },

  "phase": "secondary",

  "gates": {
    "reference": "pass",
    "blockout": "pass",
    "primary_form": "pass",
    "secondary_form": "pending",
    "tertiary_detail": "locked",
    "high_poly_qa": "locked",
    "retopology": "locked",
    "uv": "locked",
    "bake": "locked",
    "material": "locked",
    "lookdev": "locked",
    "final_render": "locked",
    "export": "locked"
  },

  "quality": {
    "silhouette": 0.91,
    "proportion": 0.88,
    "primary_form": 0.92,
    "secondary_form": 0.71,
    "surface_detail": null,
    "topology": null,
    "uv": null,
    "bake": null,
    "material": null,
    "render": null
  },

  "defects": [
    {
      "id": "d-004",
      "gate": "secondary_form",
      "severity": "high",
      "region": "shoulder",
      "issue": "deltoid volume too flat",
      "status": "open",
      "round": 1
    }
  ],

  "budget": {
    "gate": "secondary_form",
    "attempts": 1,
    "max": 3
  },

  "checkpoints": {
    "blockout": ".blender-agent/checkpoints/01_blockout_pass.blend",
    "primary_form": ".blender-agent/checkpoints/02_primary_pass.blend"
  },

  "history": [
    {
      "at": "2026-10-22T10:12:00+08:00",
      "event": "gate_pass",
      "gate": "primary_form",
      "score": 0.92
    }
  ],

  "next_action": "fix_secondary_forms"
}
```

---

## 3. 字段规范

### asset.kind

```text
character | creature | hard_surface | prop | vehicle | product | environment
```

### asset.target

```text
game | film | hero | closeup | realtime | print
```

target 决定阈值与预算，见 `asset-types.md`。

### gates

固定 13 项，不得增删。取值：

```text
locked | pending | pass | fail | invalid
```

不变量：

```text
1. phase 对应的 gate 必须是 pending / fail（正在做的阶段）
2. 一个 gate 为 locked 时，其前置 gate 必定非 pass
3. 一个 gate 为 pass 时，其所有前置 gate 必定 pass
4. 同一时刻最多一个 gate 为 pending 或 fail
```

### quality

`null` 表示尚未测量。不为 null 时取最近一次 QA 的分数。
分数不参与放行判定。

### defects

```text
id       唯一，格式 d-NNN
gate     发现该缺陷的 gate
severity critical | high | medium | low
status   open | fixed | wontfix | deferred
round     第几轮发现
```

只有 `severity in {critical, high} and status == open` 才阻塞流程。

### budget

```text
gate      当前计数的 gate
attempts  已用自动返工次数
max       默认 3
```

重置规则：

```text
gate 被置为 invalid 并重新进入 → attempts = 0
gate pass → 移动到下一 gate 时重置
进入 needs_review → 冻结该项目，等待用户决策
```

### next_action

建议用动词短语，便于直接执行：

```text
analyze_reference | build_blockout | refine_primary | fix_secondary_forms |
add_tertiary_detail | run_high_poly_qa | retopologize | unwrap_uv |
setup_bake | author_material | run_lookdev | final_render | export_asset |
needs_review
```

---

## 4. 更新时机

必须写回 state 的时机：

```text
1. 会话启动、场景快照核对后
2. 每次 gate 结果变化
3. 每次 checkpoint 创建
4. 每次 gate 失效传播
5. 每次进入 / 退出 needs_review
6. 每次用户改变交付要求（target/style/delivery）
```

不要在每个微小操作后写 state；一次阶段内只在关键节点写。

---

## 5. 写回流程

```text
1. 读取现值
2. 构造新值（保持字段完整）
3. 写入 state.json.tmp
4. 校验 JSON 与不变量
5. 原子替换 state.json
```

写入失败时保留旧文件，不要留下半截 JSON。
