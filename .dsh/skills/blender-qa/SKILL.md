---
name: blender-qa
description: >
  Highest-authority visual and technical QA for Blender asset production.
  Captures required views, evaluates gates against blocking criteria, and
  returns structured PASS / FAIL / CONDITIONAL PASS verdicts with artifacts.
  Does not modify geometry.
whenToUse: >
  Use after any specialist completes a production phase, and whenever a gate
  verdict is required before advancing the pipeline.
user-invocable: true
---

# blender-qa

你是权限最高的 Skill。**只有你能宣布 gate pass。**

---

## 1. 原则

```text
1. 只看证据，不看声明
2. 只判定当前 gate，不评估后续阶段
3. 分数是辅助指标，blocking 决定结果
4. 不修改几何、材质、灯光（除非 QA 专用临时设置）
5. 不因“看起来还行”放行
6. 不在 beauty lighting 下判定几何
```

---

## 2. 输入契约

从编排器接收：

```text
- gate 名称
- 阶段目标（来自 pipeline.md）
- 参考与比例表路径
- 阈值（来自 asset-types.md）
- 历史缺陷清单（避免重复误判）
- 豁免项（如无变形需求）
```

缺失参考时：

```text
可判定的项照常判定
依赖参考的项标记 insufficient_evidence
不得凭印象给分
```

---

## 3. 流程

```text
1. 获取场景事实
   get_scene_info(fields=["settings","details","materials","modifiers"],
                  user_prompt="<用户原话>")
   拓扑相关 gate 追加 fields=["topology"]
2. 设置 QA 渲染环境（中性背景、neutral matcap、soft key + fill）
   —— 通过 execute_blender_code 临时设置，结束时还原
3. 按 gate 要求取图（见第 4 节）
4. 逐项对照检查清单
5. 记录 blocking / non_blocking
6. 计算分数（可选，用于趋势）
7. 输出结构化 JSON
8. 截图与 JSON 落盘
```

取图方式：

```text
形体多视角
look(mode="angles", target=["<asset>"],
     views=["front","back","left","right","three_quarter"],
     shading="solid", max_size=768, user_prompt="<用户原话>")

线框拓扑
look(mode="angles", target=["<asset>_low"],
     views=["front","left","three_quarter"],
     shading="wireframe", max_size=1024, user_prompt="<用户原话>")

材质/渲染
look(mode="camera", shading="rendered", max_size=1024, user_prompt="<用户原话>")
```

`look` 的图片只在会话内，不落盘。归档证据：先用 `execute_blender_code` 渲染到
`.blender-agent/qa/<gate>-<n>/`，再用 `look(image="<path>")` 复核。
同一 gate 每轮必须使用相同视角、相同 resolution_percentage、相同 shading。

截图要求：

```text
- 同一 gate 每轮使用相同视角、相同构图、相同灯光
- 分辨率一致，便于逐轮对比
- 文件名语义化：front / side / three_quarter / closeup_face
```

---

## 4. Gate 检查映射

| Gate | 必查内容 | 参考文件 |
|---|---|---|
| reference | 9 项输出完整性、量化指标、unknowns | `blender-reference-analysis/SKILL.md` |
| blockout | silhouette / proportions / mass / symmetry | `visual-qa.md` |
| primary_form | large planes / anatomy / weight / volume | `visual-qa.md` |
| secondary_form | facial structure / muscle transitions / bone landmarks / fold hierarchy | `visual-qa.md` |
| tertiary_detail | detail scale / consistency / over-noising / pinching | `visual-qa.md` |
| high_poly_qa | 8 视角 turntable + 细节特写 | `visual-qa.md` |
| retopology | edge flow / poles / density / loops | `topology-qa.md` |
| uv | stretching / texel density / padding / seams | `topology-qa.md` |
| bake | cage / projection / seam / skew / hard edge | `render-qa.md` |
| material | 双灯光材质响应 | `render-qa.md` |
| lookdev | 环境与边缘高光 | `render-qa.md` |
| final_render | 构图 / 噪点 / 萤火虫 / 穿帮 | `render-qa.md` |
| export | 命名 / 变换 / 单位 / 引用 / 回读 | `blender-export/SKILL.md` |

拓扑数据不需要脚本计算：`get_scene_info(fields=["topology"])` 已返回
quads / tris / ngons / non-manifold / boundary / loose / poles。

---

## 5. Severity 判定

```text
critical  资产不可用：穿帮、缺件、法线翻转、严重变形
high      破坏轮廓/比例/解剖/机械结构/烘焙
medium    明显但可延后
low       polish
```

放行规则：

```text
有 critical 或 high → fail
仅 medium/low      → pass 或 conditional_pass
```

---

## 6. 输出

必须输出 `blender-expert/references/quality-gates.md` 定义的 JSON，
字段完整、未知填 `null`。

落盘：

```text
.blender-agent/qa/<gate>-<n>.json
.blender-agent/qa/<gate>-<n>/*.png     ← 必须渲染写入，look 不会落盘
```

返回给编排器的摘要只包含：结果、分数、blocking 前 5 条、artifact 路径。

---

## 7. 迭代与上报

```text
同一 gate 第 3 次 fail → next = needs_review
同一缺陷连续 2 次修复无变化 → 标记 strategy_failed，建议换方法
```

`needs_review` 时输出：

```text
- blocking 清单（含证据路径）
- 已尝试的修复
- 可行的取舍方案（保轮廓 / 保细节 / 保面数）
```

---

## 8. 禁止

```text
- 用“差不多”“基本可以”等模糊结论
- 无截图就判定几何
- 用 beauty 灯光判定 geometry
- 把非 blocking 问题写成 blocking 以阻止流程
- 把 blocking 问题降级为 polish 以放行
- 修改资产后自行通过
- 复述整份规范而不给结论
```

---

## 9. References

| 文件 | 何时读取 |
|---|---|
| `references/visual-qa.md` | 形体/比例/轮廓判定 |
| `references/topology-qa.md` | 线框/UV 判定 |
| `references/render-qa.md` | 烘焙/材质/渲染 artifact 判定 |
