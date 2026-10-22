# Asset Types

本文件定义资产分类、路由判定、质量阈值与默认预算。

---

## 1. 分类维度

| 字段 | 取值 | 影响 |
|---|---|---|
| `kind` | character / creature / hard_surface / prop / vehicle / product / environment | 决定 specialist 路由与检查清单 |
| `target` | game / film / hero / closeup / realtime | 决定阈值、面数预算、贴图策略 |
| `style` | realistic / stylized / cartoon / sculptural | 决定解剖精度与细节密度 |
| `delivery` | fbx / glb / usd / obj / blend + 贴图集合 | 决定 export gate 检查项 |

---

## 2. 阈值

```text
production asset: 0.85
hero asset:       0.90
close-up asset:   0.93
```

映射：

```text
target == game      → 0.85
target == realtime  → 0.85
target == film      → 0.90
target == hero      → 0.90
target == closeup   → 0.93
```

`style == cartoon / stylized` 时，比例与轮廓阈值不变，但解剖细节不作为
blocking；shape language 一致性成为 blocking。

---

## 3. 路由判定

### hard-surface 类（character 除外）

命中任一即走 `blender-modeling`：

```text
kind in {hard_surface, prop, vehicle, product, environment}
主要形状由平面、倒角、布尔、阵列、机械结构构成
需要精确尺寸或工程比例
```

### organic 类

命中任一即走 `blender-sculpt`（primary 之后）：

```text
kind in {character, creature}
需要肌肉、脂肪、皮肤褶皱、生物体积
需要面部表情或变形动画
```

### 混合资产

```text
主体轮廓 → 决定路由
附属部件 → 在对应阶段单独处理，不改变主流程
例：机甲角色 → 主体 hard_surface（modeling），
    暴露的肌肉 → 单独 sculpt 子任务，不阻塞主 gate
```

---

## 4. 各类型关键检查

### character

```text
proportion / anatomy / face structure / deformation loops /
eye & mouth loops / finger joints
```

### creature

```text
body mass / limb proportion / head-body ratio / surface continuity /
optional rig readiness
```

### hard_surface

```text
major mechanical structure / bevel consistency / panel gap rhythm /
shading continuity / support geometry
```

### prop

```text
silhouette / scale / wear logic / material regions
```

### vehicle

```text
wheelbase / panel alignment / symmetry / scale
```

### product

```text
exact dimensions / edge quality / material separation / logo placement
```

### environment

```text
blockout readability / modularity / texel budget / collision proxy
```

---

## 5. 默认预算

以下为起点值，按实际管线调整；一旦写入 state 即作为该资产预算。

| target | 低模面数参考 | 贴图 | 烘焙 |
|---|---|---|---|
| game | 按角色/道具分级，需显式确认 | 1–4 张 2K | normal + AO + ORM |
| realtime | 同 game，更严格 | 2K | normal + AO |
| film | 高模可用，低模仅用于辅助 | 4K+ | 按需 |
| hero | 高模 + 精细低模 | 4K | normal + AO + curvature |
| closeup | 高模主导 | 4K+ | 全套 |

面数预算必须在 blockout 前确认并写入 `asset.delivery` 或预算备注，
否则 retopology gate 无法判定。

---

## 6. 复杂度提示

```text
单一硬表面道具：可跳过 sculpt
纯 procedural 资产：可跳过 uv/bake，但必须声明
无变形需求的道具：可豁免 deformation loops 检查
```

豁免必须写入 state，并在 QA 输出中标注 `waived: true`，
不得静默跳过。
