# Quality Gates

QA 由 `blender-qa` 执行。本文件是编排器侧的调用契约：什么时候必须做、
要哪些视角、输出什么结构、如何判定 blocking。

---

## 1. 何时必须截图 QA

不要每操作一步就截图。只在以下强制检查点截图。

| Gate | QA 编号 | 必需视角 |
|---|---|---|
| reference | — | 文档检查（9 项输出完整、指标可量化），无渲染 |
| blockout | QA-01 | Front / Back / Left / Right / 3-4 Front / 3-4 Back（角色加正交正视、侧视） |
| primary_form | QA-02 | 同上，neutral matcap，无材质 |
| secondary_form | QA-03 | 同上 + 面部/关节特写 |
| tertiary_detail | QA-04 | 8 视角 turntable + 细节特写 |
| high_poly_qa | QA-04 | 8 视角 turntable + 细节特写（复检主轮廓） |
| retopology | QA-05 | wireframe：front / side / 3-4 / 关节特写 / 面部特写 |
| uv | QA-06 | UV layout + checker render + seam 位置 |
| bake | QA-07 | normal / AO / curvature / displacement 各自单独出图 |
| material | QA-08 | neutral studio + HDRI，至少两套灯光 |
| lookdev | QA-08b | 同上，含材质响应与边缘高光 |
| final_render | QA-09 | 最终构图 + 局部裁切 |
| export | QA-10 | 导入回读截图 + 文件清单 |

QA 灯光要求：

```text
QA 阶段：neutral background + neutral matcap + soft key + fill（+ 可选 rim）
禁止：戏剧性灯光、强轮廓光、彩色氛围光
```

---

## 2. 每个 Gate 的检查项

### QA-01 Blockout

```text
silhouette / proportions / mass distribution / symmetry / reference match
```

### QA-02 Primary Sculpt

```text
large planes / anatomy / weight / volume / silhouette
```

### QA-03 Secondary Sculpt（最关键）

```text
facial structure / muscle transitions / bone landmarks /
fold hierarchy / form readability
```

### QA-04 High Poly Final

```text
detail scale / detail consistency / over-noising / pinching /
sculpt artifacts / surface rhythm
```

### QA-05 Retopology

```text
edge flow / poles / spirals / triangles / ngons /
density / deformation loops
```

### QA-06 UV

```text
stretching / texel density / padding / island orientation / seams
```

### QA-07 Bake

```text
cage errors / projection artifacts / seam artifacts / skewing / hard-edge problems
```

### QA-08 / 08b Material & Lookdev

```text
material response under two lighting setups / energy conservation /
roughness breakup / normal strength / texture resolution
```

### QA-09 Final Render

```text
composition / lighting / material response / silhouette readability /
texture resolution / clipping / noise / fireflies / shadow artifacts
```

### QA-10 Export

```text
naming / transforms applied / unit scale / material references /
texture paths / poly budget / re-import sanity check
```

---

## 3. 输出 schema

QA 必须返回以下 JSON（字段不得省略，未知用 `null`）：

```json
{
  "gate": "secondary_form",
  "result": "fail",
  "score": 0.76,
  "score_breakdown": {
    "silhouette": 0.72,
    "proportion": 0.80,
    "form_readability": 0.75,
    "surface_quality": null
  },
  "blocking": [
    {
      "region": "face",
      "issue": "jaw width inconsistent with reference",
      "severity": "high",
      "evidence": "qa/secondary_form-2/front.png",
      "fix_hint": "reduce jaw width ~8%, keep chin point"
    }
  ],
  "non_blocking": [
    {
      "region": "forehead",
      "issue": "surface slightly uneven",
      "severity": "low",
      "evidence": "qa/secondary_form-2/three_quarter.png"
    }
  ],
  "artifacts": {
    "dir": ".blender-agent/qa/secondary_form-2",
    "views": ["front", "back", "left", "right", "three_quarter_front", "three_quarter_back"]
  },
  "next": "return_to_sculpt"
}
```

`next` 取值：

```text
advance / return_to_modeling / return_to_sculpt / return_to_retopology /
return_to_uv / return_to_bake / return_to_material / return_to_lighting /
needs_review
```

---

## 4. Severity 与放行判定

```text
critical  → 资产不可用（穿帮、翻转法线、缺失部件、严重变形）
high      → 破坏轮廓/比例/解剖/机械结构/烘焙
medium    → 明显但可延后，影响质感
low       → polish
```

判定规则：

```text
存在 critical 或 high  → result = fail，禁止进入下一阶段
仅存在 medium/low      → result = conditional_pass 或 pass
```

`score` 不参与放行判定，只用于趋势与优先级排序。

---

## 5. 分数口径（避免主观漂移）

分数是 0–1 的目视匹配度，按以下锚点打分：

| 值 | 含义 |
|---|---|
| 0.95–1.00 | 与参考在轮廓与比例上几乎无法区分 |
| 0.90–0.95 | 非专业观察者难以指出差异 |
| 0.85–0.90 | 专业人士能指出 1–2 处小偏差，不影响识别 |
| 0.70–0.85 | 明显偏差，影响轮廓或比例 |
| < 0.70 | 结构性错误 |

同一 gate 的分数必须沿用上一轮相同视角与相同灯光，否则不可比较。

---

## 6. Blocking vs Polish

```text
Blocking（必须解决）：
- 眼睛位置错误
- 头太宽
- 肩膀比例错误
- 法线烘焙有明显 artifact
- 关节 loop 缺失

Polish（预算允许时处理）：
- 嘴角可以再自然一点
- 皮肤 roughness 可以更丰富
- 某个划痕可以更随机
```

Agent 不得因为 polish 反复重渲染。若本轮只剩 polish：

```text
result = pass（记录遗留项）
或 conditional_pass（若用户要求高质量）
```

---

## 7. 防无限循环

```text
1. 每 gate 自动返工 3 次
2. 第 3 次仍 fail → needs_review
3. needs_review 时必须输出：blocking 清单、已尝试方案、取舍建议
4. 禁止在无新证据的情况下重复同一修复
```

同一缺陷修复 2 次无变化时，视为“修复策略错误”，必须换方法或上报，
不得第 3 次原样重试。
