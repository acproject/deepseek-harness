---
name: blender-retopology
description: >
  Produces production-ready low-poly topology from an approved high-poly
  sculpt: edge flow, deformation loops, pole placement, density control and
  game/film strategy selection. Operates through Blender-MCP.
whenToUse: >
  Use when phase is retopology, high-poly shape has passed QA, and major
  shape changes are unlikely.
user-invocable: true
---

# blender-retopology

你负责把高模转成可用的低模拓扑。**不是减面，是重建结构。**

---

## 1. 前置条件

```text
high_poly_qa == pass
primary_form == pass
secondary_form == pass
required tertiary detail complete
major shape changes unlikely
```

不满足则退回 sculpt。禁止用“看起来差不多”作为依据。

---

## 2. 进入后默认：HIGH POLY SHAPE FREEZE

禁止大规模修改：

```text
body proportions / face proportions / large mechanical volumes / silhouette
```

若必须修改：

```text
retopo_gate = invalidated
→ return sculpt/modeling
→ fix high poly
→ re-run high-poly QA
→ restart/update retopo
```

---

## 3. 策略选择

```text
target in {film, hero, closeup}
→ subdivision flow / clean quads / deformation / close-up quality

target in {game, realtime}
→ silhouette preservation / triangle budget / normal bake quality /
  joint deformation / LOD readiness

hard_surface
→ 不盲目追求全四边形，允许合理三角/五边
```

---

## 4. 工作流

```text
1. 获取高模事实
   get_scene_info(query="<asset>", fields=["details","size","modifiers"],
                  user_prompt="<用户原话>")
2. 复制高模作为参考（冻结、不可选），保留原高模
3. 建立低模对象，命名 <asset>_low
4. 用吸附/收缩（shrinkwrap）跟随高模表面，全部通过 execute_blender_code
5. 先做主结构：躯干 → 四肢 → 头 → 手 → 足
6. 再做关节环线与面部环线
7. 对称处理：先做一半，再镜像并焊接中心线
8. 清理：合并重叠、删除内部面、统一法线
9. 线框截图 QA
```

线框检查直接使用：

```text
look(mode="angles", target=["<asset>_low"],
     views=["front","left","three_quarter"],
     shading="wireframe", max_size=1024, user_prompt="<用户原话>")
```

量化数据用 `get_scene_info(query="<asset>_low", fields=["topology"])`，
直接读取 quads / tris / ngons / non-manifold / boundary / loose / poles。

顺序理由：先大结构后关节，避免局部环线被整体改动破坏。

---

## 5. 密度控制

```text
game：面数预算优先，剪影保持，关节加密
film：均匀四边面，支持细分，环线连续
hard surface：平面最少面，圆角按倒角段数
```

规则：

```text
- 曲率大处密，平坦处疏
- 不出现长宽比 > 4 的细长面
- 不出现连续极点群
- 变形区不得有 n-gon
```

---

## 6. 变形环线（角色必查）

```text
eye loops / mouth loops / nasolabial flow / jaw /
shoulder / elbow / wrist / hip / knee / ankle / finger joints
```

详见 `references/deformation-loops.md`、`references/face-topology.md`。

---

## 7. 硬表面拓扑

```text
允许 triangles / ngons
前提：
- 不破坏 shading
- 不破坏 subdivision
- 不影响 deformation
- 导出后引擎/渲染器验证通过
```

---

## 8. 禁止

```text
- 自动 remesh 后不清理就交付
- 低模与高模轮廓明显偏离
- 用减面修改器替代手工重拓扑（除非明确声明为辅助流程）
- 未冻结高模就同步修改
- 在未通过线框 QA 前进入 UV
```

---

## 9. QA 交接

必须提交 `blender-qa`，使用 wireframe overlay，截图：

```text
front / side / 3-4 / joint closeups / face closeup
```

检查项：

```text
edge flow / poles / spirals / triangles / ngons / density / deformation loops
```

同时提供：

```text
- 低模面数（总计与分区）
- 与高模的偏差说明（如有）
- 豁免项（如无变形需求）
```

---

## 10. 输出

```text
- 低模对象与面数
- 拓扑截图目录
- 已知风险区域
- next_action
```

不得自行宣布 pass。

---

## 11. References

| 文件 | 何时读取 |
|---|---|
| `references/deformation-loops.md` | 角色/可动部件 |
| `references/face-topology.md` | 头部/面部 |
| `references/game-topology.md` | game / realtime 目标 |
